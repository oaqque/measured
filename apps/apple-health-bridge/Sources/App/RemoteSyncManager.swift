import CryptoKit
import Foundation
import UIKit

@MainActor
final class RemoteSyncManager: ObservableObject {
    @Published var receiverBaseURLString: String {
        didSet {
            userDefaults.set(receiverBaseURLString, forKey: receiverBaseURLKey)
        }
    }
    @Published var tailscaleCredentialString: String {
        didSet {
            userDefaults.set(tailscaleCredentialString, forKey: tailscaleCredentialKey)
        }
    }
    @Published private(set) var isSending = false
    @Published private(set) var isDiscovering = false
    @Published private(set) var lastError: String?
    @Published private(set) var lastSummary: String?
    @Published private(set) var lastDiscoveryError: String?
    @Published private(set) var lastDiscoverySummary: String?
    @Published private(set) var discoveredDevices: [TailscaleDiscoveredDevice] = []

    private let userDefaults: UserDefaults
    private let ledgerStore = BridgeFileStore<RemoteSyncLedger>(filename: "remote-sync-ledger.json")
    private let receiverBaseURLKey = "remote-sync-receiver-base-url"
    private let tailscaleCredentialKey = "tailscale-discovery-credential"
    private var ledger: RemoteSyncLedger
    private let maxBatchBytes = 4_500_000
    private let urlSession: URLSession

    init(userDefaults: UserDefaults = .standard, urlSession: URLSession = .shared) {
        self.userDefaults = userDefaults
        self.urlSession = urlSession
        self.receiverBaseURLString = userDefaults.string(forKey: receiverBaseURLKey) ?? ""
        self.tailscaleCredentialString = userDefaults.string(forKey: tailscaleCredentialKey) ?? ""
        self.ledger = (try? ledgerStore.loadValue()) ?? RemoteSyncLedger()
    }

    var hasReceiverConfigured: Bool {
        receiverBaseURL != nil
    }

    func syncSnapshot(_ snapshot: AppleHealthExportSnapshot) async -> Bool {
        guard !isSending else {
            return false
        }

        guard let receiverBaseURL else {
            lastError = "Set a receiver URL to enable direct sync."
            return false
        }

        isSending = true
        lastError = nil
        defer { isSending = false }

        do {
            let status: RemoteSyncStatusResponse = try await sendRequest(
                path: "/health-sync/status",
                method: "GET",
                baseURL: receiverBaseURL
            )

            guard status.protocolVersion == 1 else {
                throw NSError(domain: "RemoteSyncManager", code: 3, userInfo: [
                    NSLocalizedDescriptionKey: "Receiver uses unsupported protocol version \(status.protocolVersion).",
                ])
            }

            let currentState = try CurrentSnapshotState(snapshot: snapshot)
            let requiresFullResync = status.lastAppliedCheckpoint != ledger.lastAppliedCheckpoint
            let changes = requiresFullResync
                ? currentState.fullChangeSet()
                : currentState.incrementalChangeSet(from: ledger)

            guard changes.hasAnyChanges else {
                lastSummary = "Receiver is already up to date at \(status.lastAppliedCheckpoint ?? "no checkpoint")."
                return true
            }

            let checkpoint = buildCheckpointIdentifier()
            let sessionRequest = RemoteSyncSessionCreateRequest(
                senderId: UIDevice.current.name,
                schema: "apple-health-cache.v1",
                baseCheckpoint: status.lastAppliedCheckpoint,
                newCheckpoint: checkpoint
            )
            let session: RemoteSyncSessionCreateResponse = try await sendRequest(
                path: "/health-sync/session",
                method: "POST",
                body: sessionRequest,
                baseURL: receiverBaseURL
            )

            let batchPayloads = try buildBatchPayloads(sessionId: session.sessionId, changes: changes)
            for payload in batchPayloads {
                let _: RemoteSyncSessionStatusResponse = try await sendRawJSONRequest(
                    path: session.uploadUrl,
                    method: "POST",
                    body: payload,
                    baseURL: receiverBaseURL
                )
            }

            let rootHash = batchPayloads.isEmpty ? nil : hashRawPayloads(batchPayloads)
            let commitRequest = RemoteSyncCommitRequest(
                sessionId: session.sessionId,
                newCheckpoint: checkpoint,
                batchCount: batchPayloads.count,
                rootHash: rootHash
            )
            let commitResponse: RemoteSyncCommitResponse = try await sendRequest(
                path: session.commitUrl,
                method: "POST",
                body: commitRequest,
                baseURL: receiverBaseURL
            )

            ledger = RemoteSyncLedger(
                lastAppliedCheckpoint: commitResponse.appliedCheckpoint,
                activityHashes: currentState.activityHashes,
                routeHashes: currentState.routeHashes,
                collectionHashes: currentState.collectionHashes,
                exportedDeletedActivityIds: snapshot.deletedActivityIds.sorted()
            )
            try ledgerStore.saveValue(ledger)

            lastSummary = [
                "Applied checkpoint \(commitResponse.appliedCheckpoint).",
                "Activities: \(changes.activitiesUpsert.count) upserts, \(changes.activitiesDelete.count) deletions.",
                "Routes: \(changes.routesUpsert.count) upserts.",
                "Collections: \(changes.collectionsUpsert.count) upserts.",
            ].joined(separator: " ")
            return true
        } catch {
            lastError = error.localizedDescription
            return false
        }
    }

    func discoverReceivers() async {
        guard !isDiscovering else {
            return
        }

        let credential = tailscaleCredentialString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !credential.isEmpty else {
            lastDiscoveryError = "Paste a Tailscale API token or OAuth access token before discovery."
            lastDiscoverySummary = nil
            discoveredDevices = []
            return
        }

        isDiscovering = true
        lastDiscoveryError = nil
        defer { isDiscovering = false }

        do {
            let devices = try await fetchTailscaleDevices(credential: credential)
            let eligibleDevices = devices
                .filter(\.isEligibleForReceiverProbe)
                .sorted { $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending }

            var discoveryResults: [TailscaleDiscoveredDevice] = []
            for device in eligibleDevices {
                discoveryResults.append(await probeReceiver(on: device))
            }

            discoveredDevices = discoveryResults
            let availableCount = discoveryResults.filter(\.hasReceiver).count
            lastDiscoverySummary = "Loaded \(devices.count) tailnet devices. Checked \(discoveryResults.count) eligible devices. Found \(availableCount) available receivers."
            if availableCount == 0 {
                lastDiscoveryError = nil
            }
        } catch {
            discoveredDevices = []
            lastDiscoverySummary = nil
            lastDiscoveryError = error.localizedDescription
        }
    }

    private var receiverBaseURL: URL? {
        let trimmed = receiverBaseURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return nil
        }

        let normalized = trimmed.hasSuffix("/") ? String(trimmed.dropLast()) : trimmed
        return URL(string: normalized)
    }

    private func buildCheckpointIdentifier() -> String {
        "ckpt_\(Date().ISO8601Format())_\(UUID().uuidString.prefix(8))"
    }

    private func fetchTailscaleDevices(credential: String) async throws -> [TailscaleAPIDevice] {
        let url = URL(string: "https://api.tailscale.com/api/v2/tailnet/-/devices")!
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase

        do {
            var request = URLRequest(url: url)
            request.httpMethod = "GET"
            request.timeoutInterval = 30
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            request.setValue("Bearer \(credential)", forHTTPHeaderField: "Authorization")

            let (data, response) = try await urlSession.data(for: request)
            if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 401, credential.hasPrefix("tskey-api") {
                return try await fetchTailscaleDevicesUsingBasicAuth(
                    credential: credential,
                    decoder: decoder,
                    url: url
                )
            }

            try validateHTTPResponse(response, data: data)
            return try decodeTailscaleDevices(from: data, using: decoder)
        } catch {
            if credential.hasPrefix("tskey-api") {
                return try await fetchTailscaleDevicesUsingBasicAuth(
                    credential: credential,
                    decoder: decoder,
                    url: url
                )
            }

            throw error
        }
    }

    private func fetchTailscaleDevicesUsingBasicAuth(
        credential: String,
        decoder: JSONDecoder,
        url: URL
    ) async throws -> [TailscaleAPIDevice] {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let basicCredential = Data("\(credential):".utf8).base64EncodedString()
        request.setValue("Basic \(basicCredential)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await urlSession.data(for: request)
        try validateHTTPResponse(response, data: data)
        return try decodeTailscaleDevices(from: data, using: decoder)
    }

    private func decodeTailscaleDevices(from data: Data, using decoder: JSONDecoder) throws -> [TailscaleAPIDevice] {
        if let response = try? decoder.decode(TailscaleDeviceListResponse.self, from: data) {
            return response.devices
        }

        if let devices = try? decoder.decode([TailscaleAPIDevice].self, from: data) {
            return devices
        }

        throw NSError(domain: "RemoteSyncManager", code: 4, userInfo: [
            NSLocalizedDescriptionKey: "Could not decode the Tailscale devices response.",
        ])
    }

    private func probeReceiver(on device: TailscaleAPIDevice) async -> TailscaleDiscoveredDevice {
        let candidates = device.receiverCandidateBaseURLs
        var probeFailures: [String] = []
        for candidate in candidates {
            do {
                let status = try await probeReceiverStatus(baseURL: candidate)

                guard status.protocolVersion == 1 else {
                    continue
                }

                return TailscaleDiscoveredDevice(
                    id: device.id ?? device.displayName,
                    displayName: device.displayName,
                    osName: device.os ?? "unknown",
                    dnsName: device.normalizedDNSName,
                    ipv4Address: device.primaryIPv4Address,
                    receiverBaseURLString: candidate.absoluteString,
                    receiverId: status.receiverId,
                    availabilitySummary: "Receiver available",
                    failureDetails: []
                )
            } catch {
                probeFailures.append("\(candidate.absoluteString): \(probeErrorMessage(error))")
                continue
            }
        }

        return TailscaleDiscoveredDevice(
            id: device.id ?? device.displayName,
            displayName: device.displayName,
            osName: device.os ?? "unknown",
            dnsName: device.normalizedDNSName,
            ipv4Address: device.primaryIPv4Address,
            receiverBaseURLString: nil,
            receiverId: nil,
            availabilitySummary: "No receiver responded on port 8788",
            failureDetails: probeFailures
        )
    }

    private func probeReceiverStatus(baseURL: URL) async throws -> RemoteSyncStatusResponse {
        var request = URLRequest(url: resolvedURL(for: "/health-sync/status", baseURL: baseURL))
        request.httpMethod = "GET"
        request.timeoutInterval = 5
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await urlSession.data(for: request)
        try validateHTTPResponse(response, data: data)
        return try JSONDecoder().decode(RemoteSyncStatusResponse.self, from: data)
    }

    private func buildBatchPayloads(sessionId: String, changes: SnapshotChangeSet) throws -> [Data] {
        var batches: [Data] = []
        var sequence = 1
        var currentBatch = RemoteSyncDeltaBatch(sessionId: sessionId, sequence: sequence)

        for activity in changes.activitiesUpsert {
            try append(activity, to: &currentBatch, batches: &batches, sequence: &sequence)
        }

        for route in changes.routesUpsert {
            try append(route, to: &currentBatch, batches: &batches, sequence: &sequence)
        }

        for collection in changes.collectionsUpsert {
            try append(collection, to: &currentBatch, batches: &batches, sequence: &sequence)
        }

        for deletedActivityId in changes.activitiesDelete {
            try append(deletedActivityId, to: &currentBatch, batches: &batches, sequence: &sequence)
        }

        if currentBatch.hasAnyChanges {
            batches.append(try encodeBatch(currentBatch))
        }

        return batches
    }

    private func append(
        _ activity: RemoteSyncActivityUpsert,
        to batch: inout RemoteSyncDeltaBatch,
        batches: inout [Data],
        sequence: inout Int
    ) throws {
        var candidate = batch
        candidate.activitiesUpsert.append(activity)
        try finalizeIfNeeded(candidate, current: &batch, batches: &batches, sequence: &sequence)
    }

    private func append(
        _ route: RemoteSyncRouteUpsert,
        to batch: inout RemoteSyncDeltaBatch,
        batches: inout [Data],
        sequence: inout Int
    ) throws {
        var candidate = batch
        candidate.routesUpsert.append(route)
        try finalizeIfNeeded(candidate, current: &batch, batches: &batches, sequence: &sequence)
    }

    private func append(
        _ collection: RemoteSyncCollectionUpsert,
        to batch: inout RemoteSyncDeltaBatch,
        batches: inout [Data],
        sequence: inout Int
    ) throws {
        var candidate = batch
        candidate.collectionsUpsert.append(collection)
        try finalizeIfNeeded(candidate, current: &batch, batches: &batches, sequence: &sequence)
    }

    private func append(
        _ deletedActivityId: String,
        to batch: inout RemoteSyncDeltaBatch,
        batches: inout [Data],
        sequence: inout Int
    ) throws {
        var candidate = batch
        candidate.activitiesDelete.append(deletedActivityId)
        try finalizeIfNeeded(candidate, current: &batch, batches: &batches, sequence: &sequence)
    }

    private func finalizeIfNeeded(
        _ candidate: RemoteSyncDeltaBatch,
        current batch: inout RemoteSyncDeltaBatch,
        batches: inout [Data],
        sequence: inout Int
    ) throws {
        let candidateData = try encodeBatch(candidate)
        if candidateData.count <= maxBatchBytes {
            batch = candidate
            return
        }

        guard batch.hasAnyChanges else {
            throw NSError(domain: "RemoteSyncManager", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "A single sync payload exceeded the maximum batch size.",
            ])
        }

        batches.append(try encodeBatch(batch))
        sequence += 1
        batch = RemoteSyncDeltaBatch(sessionId: candidate.sessionId, sequence: sequence)

        var retryCandidate = batch
        retryCandidate.activitiesUpsert = Array(candidate.activitiesUpsert.suffix(1))
        retryCandidate.routesUpsert = Array(candidate.routesUpsert.suffix(1))
        retryCandidate.collectionsUpsert = Array(candidate.collectionsUpsert.suffix(1))
        retryCandidate.activitiesDelete = Array(candidate.activitiesDelete.suffix(1))

        let retryData = try encodeBatch(retryCandidate)
        if retryData.count > maxBatchBytes {
            throw NSError(domain: "RemoteSyncManager", code: 2, userInfo: [
                NSLocalizedDescriptionKey: "A single sync payload still exceeded the maximum batch size after splitting.",
            ])
        }

        batch = retryCandidate
    }

    private func encodeBatch(_ batch: RemoteSyncDeltaBatch) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(batch)
    }

    private func hashRawPayloads(_ payloads: [Data]) -> String {
        var hasher = SHA256()
        for payload in payloads {
            hasher.update(data: payload)
        }
        return "sha256:" + Data(hasher.finalize()).map { String(format: "%02x", $0) }.joined()
    }

    private func sendRequest<ResponseBody: Decodable>(
        path: String,
        method: String,
        baseURL: URL
    ) async throws -> ResponseBody {
        var request = URLRequest(url: resolvedURL(for: path, baseURL: baseURL))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 120

        let (data, response) = try await urlSession.data(for: request)
        try validateHTTPResponse(response, data: data)
        return try JSONDecoder().decode(ResponseBody.self, from: data)
    }

    private func sendRequest<RequestBody: Encodable, ResponseBody: Decodable>(
        path: String,
        method: String,
        body: RequestBody,
        baseURL: URL
    ) async throws -> ResponseBody {
        var request = URLRequest(url: resolvedURL(for: path, baseURL: baseURL))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 120

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        request.httpBody = try encoder.encode(body)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let (data, response) = try await urlSession.data(for: request)
        try validateHTTPResponse(response, data: data)
        let decoder = JSONDecoder()
        return try decoder.decode(ResponseBody.self, from: data)
    }

    private func sendRawJSONRequest<ResponseBody: Decodable>(
        path: String,
        method: String,
        body: Data,
        baseURL: URL
    ) async throws -> ResponseBody {
        var request = URLRequest(url: resolvedURL(for: path, baseURL: baseURL))
        request.httpMethod = method
        request.httpBody = body
        request.timeoutInterval = 120
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await urlSession.data(for: request)
        try validateHTTPResponse(response, data: data)
        return try JSONDecoder().decode(ResponseBody.self, from: data)
    }

    private func validateHTTPResponse(_ response: URLResponse, data: Data) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            return
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "HTTP \(httpResponse.statusCode)"
            throw NSError(domain: "RemoteSyncManager", code: httpResponse.statusCode, userInfo: [
                NSLocalizedDescriptionKey: message,
            ])
        }
    }

    private func resolvedURL(for path: String, baseURL: URL) -> URL {
        if let absoluteURL = URL(string: path), absoluteURL.scheme != nil {
            return absoluteURL
        }

        if path.hasPrefix("/") {
            return baseURL.appending(path: String(path.dropFirst()))
        }

        return baseURL.appending(path: path)
    }

    private func probeErrorMessage(_ error: Error) -> String {
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain {
            switch nsError.code {
            case NSURLErrorTimedOut:
                return "timed out"
            case NSURLErrorCannotFindHost:
                return "host not found"
            case NSURLErrorCannotConnectToHost:
                return "connection refused"
            case NSURLErrorNetworkConnectionLost:
                return "connection lost"
            case NSURLErrorNotConnectedToInternet:
                return "not connected"
            case NSURLErrorAppTransportSecurityRequiresSecureConnection:
                return "ATS blocked insecure HTTP"
            default:
                break
            }
        }

        return nsError.localizedDescription
    }
}

private struct CurrentSnapshotState {
    let snapshot: AppleHealthExportSnapshot
    let activityHashes: [String: String]
    let routeHashes: [String: String]
    let collectionHashes: [String: String]
    let routes: [String: RemoteSyncRoute]

    init(snapshot: AppleHealthExportSnapshot) throws {
        self.snapshot = snapshot
        self.routes = Dictionary(
            uniqueKeysWithValues: snapshot.activities.map { key, activity in
                (
                    key,
                    RemoteSyncRoute(
                        activityId: activity.activityId,
                        summaryPolyline: activity.summaryPolyline,
                        hasStreams: activity.hasStreams,
                        routeStreams: activity.routeStreams
                    )
                )
            }
        )
        self.activityHashes = try snapshot.activities.mapValues(hashJSON)
        self.routeHashes = try routes.mapValues(hashJSON)
        self.collectionHashes = try snapshot.collections.mapValues(hashJSON)
    }

    func fullChangeSet() -> SnapshotChangeSet {
        SnapshotChangeSet(
            activitiesUpsert: snapshot.activities.values.sorted(by: activitySort).map {
                RemoteSyncActivityUpsert(activityId: $0.activityId, hash: activityHashes[$0.activityId] ?? "", data: $0)
            },
            routesUpsert: routes.values.sorted(by: routeSort).map {
                RemoteSyncRouteUpsert(activityId: $0.activityId, hash: routeHashes[$0.activityId] ?? "", data: $0)
            },
            collectionsUpsert: snapshot.collections.values.sorted(by: collectionSort).map {
                RemoteSyncCollectionUpsert(key: $0.key, hash: collectionHashes[$0.key] ?? "", data: $0)
            },
            activitiesDelete: snapshot.deletedActivityIds.sorted()
        )
    }

    func incrementalChangeSet(from ledger: RemoteSyncLedger) -> SnapshotChangeSet {
        SnapshotChangeSet(
            activitiesUpsert: snapshot.activities.values
                .filter { activityHashes[$0.activityId] != ledger.activityHashes[$0.activityId] }
                .sorted(by: activitySort)
                .map { RemoteSyncActivityUpsert(activityId: $0.activityId, hash: activityHashes[$0.activityId] ?? "", data: $0) },
            routesUpsert: routes.values
                .filter { routeHashes[$0.activityId] != ledger.routeHashes[$0.activityId] }
                .sorted(by: routeSort)
                .map { RemoteSyncRouteUpsert(activityId: $0.activityId, hash: routeHashes[$0.activityId] ?? "", data: $0) },
            collectionsUpsert: snapshot.collections.values
                .filter { collectionHashes[$0.key] != ledger.collectionHashes[$0.key] }
                .sorted(by: collectionSort)
                .map { RemoteSyncCollectionUpsert(key: $0.key, hash: collectionHashes[$0.key] ?? "", data: $0) },
            activitiesDelete: snapshot.deletedActivityIds
                .filter { !ledger.exportedDeletedActivityIds.contains($0) }
                .sorted()
        )
    }
}

private struct SnapshotChangeSet {
    let activitiesUpsert: [RemoteSyncActivityUpsert]
    let routesUpsert: [RemoteSyncRouteUpsert]
    let collectionsUpsert: [RemoteSyncCollectionUpsert]
    let activitiesDelete: [String]

    var hasAnyChanges: Bool {
        !activitiesUpsert.isEmpty || !routesUpsert.isEmpty || !collectionsUpsert.isEmpty || !activitiesDelete.isEmpty
    }
}

private struct RemoteSyncLedger: Codable {
    var lastAppliedCheckpoint: String?
    var activityHashes: [String: String] = [:]
    var routeHashes: [String: String] = [:]
    var collectionHashes: [String: String] = [:]
    var exportedDeletedActivityIds: [String] = []
}

private struct RemoteSyncStatusResponse: Decodable {
    let protocolVersion: Int
    let receiverId: String
    let lastAppliedCheckpoint: String?
    let acceptedSchemas: [String]
    let maxBatchBytes: Int
}

private struct RemoteSyncSessionCreateRequest: Encodable {
    let senderId: String
    let schema: String
    let baseCheckpoint: String?
    let newCheckpoint: String
}

private struct RemoteSyncSessionCreateResponse: Decodable {
    let sessionId: String
    let uploadUrl: String
    let commitUrl: String
    let maxBatchBytes: Int
}

private struct RemoteSyncActivityUpsert: Codable {
    let activityId: String
    let hash: String
    let data: AppleHealthExportActivity
}

private struct RemoteSyncRouteUpsert: Codable {
    let activityId: String
    let hash: String
    let data: RemoteSyncRoute
}

private struct RemoteSyncCollectionUpsert: Codable {
    let key: String
    let hash: String
    let data: AppleHealthExportCollection
}

private struct RemoteSyncRoute: Codable {
    let activityId: String
    let summaryPolyline: String?
    let hasStreams: Bool
    let routeStreams: AppleHealthExportRouteStreams?
}

private struct RemoteSyncDeltaBatch: Codable {
    let sessionId: String
    let sequence: Int
    var activitiesUpsert: [RemoteSyncActivityUpsert] = []
    var routesUpsert: [RemoteSyncRouteUpsert] = []
    var collectionsUpsert: [RemoteSyncCollectionUpsert] = []
    var activitiesDelete: [String] = []
    var collectionsDelete: [String] = []
    var samplesDelete: [RemoteSyncDeletedSample] = []

    init(sessionId: String, sequence: Int) {
        self.sessionId = sessionId
        self.sequence = sequence
    }

    var hasAnyChanges: Bool {
        !activitiesUpsert.isEmpty || !routesUpsert.isEmpty || !collectionsUpsert.isEmpty || !activitiesDelete.isEmpty || !collectionsDelete.isEmpty || !samplesDelete.isEmpty
    }
}

private struct RemoteSyncDeletedSample: Codable {
    let collectionKey: String
    let sampleId: String
}

private struct RemoteSyncSessionStatusResponse: Decodable {
    let sessionId: String
    let state: String
    let receivedBatchCount: Int
    let expectedCheckpoint: String
    let baseCheckpoint: String?
    let senderId: String
}

private struct RemoteSyncCommitRequest: Encodable {
    let sessionId: String
    let newCheckpoint: String
    let batchCount: Int
    let rootHash: String?
}

private struct RemoteSyncCommitResponse: Decodable {
    let applied: Bool
    let appliedCheckpoint: String
}

struct TailscaleDiscoveredDevice: Identifiable, Sendable {
    let id: String
    let displayName: String
    let osName: String
    let dnsName: String?
    let ipv4Address: String?
    let receiverBaseURLString: String?
    let receiverId: String?
    let availabilitySummary: String
    let failureDetails: [String]

    var hasReceiver: Bool {
        receiverBaseURLString != nil
    }
}

private struct TailscaleDeviceListResponse: Decodable {
    let devices: [TailscaleAPIDevice]
}

private struct TailscaleAPIDevice: Decodable, Sendable {
    let id: String?
    let hostname: String?
    let name: String?
    let dnsName: String?
    let addresses: [String]?
    let os: String?
    let online: Bool?

    var normalizedDNSName: String? {
        dnsName?.trimmingCharacters(in: CharacterSet(charactersIn: "."))
    }

    var primaryIPv4Address: String? {
        addresses?.first { $0.contains(".") }
    }

    var displayName: String {
        if let hostname, !hostname.isEmpty {
            return hostname
        }

        if let normalizedDNSName, !normalizedDNSName.isEmpty {
            return normalizedDNSName
        }

        if let name, !name.isEmpty {
            return name
        }

        return id ?? "Unknown device"
    }

    var isEligibleForReceiverProbe: Bool {
        if let online, online == false {
            return false
        }

        guard let os else {
            return false
        }

        guard ["macos", "linux", "windows"].contains(os.lowercased()) else {
            return false
        }

        return normalizedDNSName != nil || primaryIPv4Address != nil
    }

    var receiverCandidateBaseURLs: [URL] {
        var urls: [URL] = []

        if let normalizedDNSName, let url = URL(string: "http://\(normalizedDNSName):8788") {
            urls.append(url)
        }

        if let primaryIPv4Address, let url = URL(string: "http://\(primaryIPv4Address):8788") {
            urls.append(url)
        }

        return urls
    }
}

private func hashJSON<T: Encodable>(_ value: T) throws -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    let data = try encoder.encode(value)
    let digest = SHA256.hash(data: data)
    return "sha256:" + digest.map { String(format: "%02x", $0) }.joined()
}

private func activitySort(_ lhs: AppleHealthExportActivity, _ rhs: AppleHealthExportActivity) -> Bool {
    (lhs.startDate ?? "", lhs.activityId) < (rhs.startDate ?? "", rhs.activityId)
}

private func routeSort(_ lhs: RemoteSyncRoute, _ rhs: RemoteSyncRoute) -> Bool {
    lhs.activityId < rhs.activityId
}

private func collectionSort(_ lhs: AppleHealthExportCollection, _ rhs: AppleHealthExportCollection) -> Bool {
    lhs.key < rhs.key
}
