import Foundation

enum AppDiagnosticsLogger {
    private static let lock = NSLock()
    private static let timestampFormatter = ISO8601DateFormatter()
    private static let authorizationLogFileName = "authorization.log"

    static func resetAuthorizationLog() {
        lock.lock()
        defer { lock.unlock() }

        let fileManager = FileManager.default
        let url = authorizationLogURL
        try? fileManager.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try? Data().write(to: url, options: .atomic)
    }

    static func appendAuthorization(_ message: String) {
        append(line: message)
    }

    private static func append(line: String) {
        lock.lock()
        defer { lock.unlock() }

        let fileManager = FileManager.default
        let url = authorizationLogURL
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
        let cachesDirectory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first ??
            URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)

        return cachesDirectory.appendingPathComponent(authorizationLogFileName)
    }
}
