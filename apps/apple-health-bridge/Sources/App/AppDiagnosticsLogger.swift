import Foundation

enum AppDiagnosticsLogger {
    private static let lock = NSLock()
    private static let timestampFormatter = ISO8601DateFormatter()
    private static let authorizationLogFileName = "authorization.log"
    private static let syncLogFileName = "sync.log"

    static func resetAuthorizationLog() {
        resetLog(at: authorizationLogURL)
    }

    static func appendAuthorization(_ message: String) {
        append(line: message, to: authorizationLogURL)
    }

    static func resetSyncLog() {
        resetLog(at: syncLogURL)
    }

    static func appendSync(_ message: String) {
        append(line: message, to: syncLogURL)
    }

    private static func resetLog(at url: URL) {
        lock.lock()
        defer { lock.unlock() }

        let fileManager = FileManager.default
        try? fileManager.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try? Data().write(to: url, options: .atomic)
    }

    private static func append(line: String, to url: URL) {
        lock.lock()
        defer { lock.unlock() }

        let fileManager = FileManager.default
        let timestamp = timestampFormatter.string(from: Date())
        let data = Data("[\(timestamp)] \(line)\n".utf8)

        try? fileManager.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )

        if !fileManager.fileExists(atPath: url.path) {
            fileManager.createFile(atPath: url.path, contents: nil)
        }

        guard let handle = try? FileHandle(forWritingTo: url) else {
            return
        }

        defer {
            try? handle.close()
        }

        do {
            try handle.seekToEnd()
            try handle.write(contentsOf: data)
        } catch {
            return
        }
    }

    private static var authorizationLogURL: URL {
        cachesDirectory.appendingPathComponent(authorizationLogFileName)
    }

    private static var syncLogURL: URL {
        cachesDirectory.appendingPathComponent(syncLogFileName)
    }

    private static var cachesDirectory: URL {
        let cachesDirectory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first ??
            URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
        return cachesDirectory
    }
}
