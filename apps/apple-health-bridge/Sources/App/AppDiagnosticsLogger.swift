import Darwin
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

    static func appendSyncMemory(_ message: String) {
        appendSync("\(message) \(memoryFootprintSummary())")
    }

    static func memoryFootprintSummary() -> String {
        guard let bytes = physicalFootprintBytes() ?? residentMemoryBytes() else {
            return "memory=unavailable"
        }

        return "memory=\(formatByteCount(bytes))"
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

    private static func physicalFootprintBytes() -> UInt64? {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
        let result = withUnsafeMutablePointer(to: &info) { pointer in
            pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { reboundPointer in
                task_info(
                    mach_task_self_,
                    task_flavor_t(TASK_VM_INFO),
                    reboundPointer,
                    &count
                )
            }
        }

        guard result == KERN_SUCCESS else {
            return nil
        }

        return UInt64(info.phys_footprint)
    }

    private static func residentMemoryBytes() -> UInt64? {
        var info = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size / MemoryLayout<natural_t>.size)
        let result = withUnsafeMutablePointer(to: &info) { pointer in
            pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { reboundPointer in
                task_info(
                    mach_task_self_,
                    task_flavor_t(MACH_TASK_BASIC_INFO),
                    reboundPointer,
                    &count
                )
            }
        }

        guard result == KERN_SUCCESS else {
            return nil
        }

        return UInt64(info.resident_size)
    }

    private static func formatByteCount(_ bytes: UInt64) -> String {
        let formatter = ByteCountFormatter()
        formatter.allowedUnits = [.useMB, .useGB]
        formatter.countStyle = .memory
        formatter.includesUnit = true
        formatter.includesCount = true
        return formatter.string(fromByteCount: Int64(bytes))
            .replacingOccurrences(of: " ", with: "")
    }
}
