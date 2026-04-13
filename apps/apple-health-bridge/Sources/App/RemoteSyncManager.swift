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
    @Published private(set) var sendProgress = BridgeProgress(
        title: "Sending health data…",
        detail: "Preparing receiver sync.",
        completedUnitCount: 0,
        totalUnitCount: 1
    )
    @Published private(set) var lastError: String?
    @Published private(set) var lastSummary: String?
    @Published private(set) var lastDiscoveryError: String?
    @Published private(set) var lastDiscoverySummary: String?
    @Published private(set) var discoveredDevices: [TailscaleDiscoveredDevice] = []

    private let userDefaults: UserDefaults
    private let replicationStateStore = BridgeFileStore<RemoteSyncLocalState>(filename: "remote-sync-state.json")
    private let legacyReplicationStateStore = BridgeFileStore<RemoteSyncLegacyLocalState>(filename: "remote-sync-v2-state.json")
    private let receiverBaseURLKey = "remote-sync-receiver-base-url"
    private let tailscaleCredentialKey = "tailscale-discovery-credential"
    private var replicationState: RemoteSyncLocalState
    private let urlSession: URLSession

    init(userDefaults: UserDefaults = .standard, urlSession: URLSession = .shared) {
        self.userDefaults = userDefaults
        self.urlSession = urlSession
        self.receiverBaseURLString = userDefaults.string(forKey: receiverBaseURLKey) ?? ""
        self.tailscaleCredentialString = userDefaults.string(forKey: tailscaleCredentialKey) ?? ""
        self.replicationState = RemoteSyncManager.loadReplicationState(
            primaryStore: replicationStateStore,
            legacyStore: legacyReplicationStateStore
        )
    }

    private static func loadReplicationState(
        primaryStore: BridgeFileStore<RemoteSyncLocalState>,
        legacyStore: BridgeFileStore<RemoteSyncLegacyLocalState>
    ) -> RemoteSyncLocalState {
        if let existing = try? primaryStore.loadValue() {
            return existing
        }

        let legacyState = (try? legacyStore.loadValue()) ?? nil
        let migrated = RemoteSyncLocalState.migrated(from: legacyState)
        try? primaryStore.saveValue(migrated)
        if legacyState != nil {
            try? legacyStore.saveValue(nil)
        }
        return migrated
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
        sendProgress = BridgeProgress(
            title: "Sending health data…",
            detail: "Checking receiver status.",
            completedUnitCount: 0,
            totalUnitCount: 3
        )
        lastError = nil
        defer { isSending = false }

        do {
            let status: RemoteSyncStatusResponse = try await sendRequest(
                path: RemoteSyncConstants.endpointPath,
                method: "GET",
                baseURL: receiverBaseURL
            )
            sendProgress = BridgeProgress(
                title: "Sending health data…",
                detail: "Loading receiver checkpoint.",
                completedUnitCount: 1,
                totalUnitCount: 4
            )

            guard status.protocolVersion == RemoteSyncConstants.protocolVersion,
                  status.schema == RemoteSyncConstants.schema else {
                throw NSError(domain: "RemoteSyncManager", code: 3, userInfo: [
                    NSLocalizedDescriptionKey: "Receiver uses unsupported protocol \(status.protocolVersion) / \(status.schema).",
                ])
            }
            guard status.blobEncoding == "gzip",
                  status.blobFormat == "ndjson",
                  status.hashAlgorithm == "sha256" else {
                throw NSError(domain: "RemoteSyncManager", code: 8, userInfo: [
                    NSLocalizedDescriptionKey: "Receiver advertised unsupported blob capabilities.",
                ])
            }

            let replicationId = replicationID(
                senderId: replicationState.senderId,
                receiverId: status.receiverId,
                schema: status.schema
            )
            let checkpointPath = "\(RemoteSyncConstants.endpointPath)/_local/\(RemoteSyncManager.percentEncodedPathComponent(replicationId))"
            let checkpointResponse: RemoteSyncCheckpointResponse?
            do {
                checkpointResponse = try await sendRequest(
                    path: checkpointPath,
                    method: "GET",
                    baseURL: receiverBaseURL
                )
            } catch {
                let nsError = error as NSError
                if nsError.code == 404 {
                    checkpointResponse = nil
                } else {
                    throw error
                }
            }

            sendProgress = BridgeProgress(
                title: "Sending health data…",
                detail: "Building canonical sync manifest.",
                completedUnitCount: 2,
                totalUnitCount: 4
            )
            let preparedSync = try RemoteSyncBuilder.prepareSync(
                snapshot: snapshot,
                state: replicationState,
                receiverStatus: status,
                checkpointSequence: checkpointResponse?.lastSequence
            )

            if !preparedSync.changed, checkpointResponse?.lastSequence == preparedSync.sequence {
                replicationState = preparedSync.nextState
                try replicationStateStore.saveValue(replicationState)
                sendProgress = BridgeProgress(
                    title: "Sending health data…",
                    detail: "Receiver is already up to date.",
                    completedUnitCount: 1,
                    totalUnitCount: 1
                )
                lastSummary = [
                    "Receiver is already up to date at sequence \(preparedSync.sequence).",
                    preparedSync.recoveredSenderState ? "Recovered sender sequence from receiver checkpoint." : "",
                ]
                .filter { !$0.isEmpty }
                .joined(separator: " ")
                return true
            }

            sendProgress = BridgeProgress(
                title: "Sending health data…",
                detail: "Planning missing sync blobs.",
                completedUnitCount: 3,
                totalUnitCount: 5
            )
            let planResponse: RemoteSyncPlanResponse = try await sendRequest(
                path: "\(RemoteSyncConstants.endpointPath)/_plan",
                method: "POST",
                body: RemoteSyncPlanRequest(
                    replicationId: preparedSync.replicationId,
                    lastSequence: preparedSync.sequence,
                    snapshot: preparedSync.manifest
                ),
                baseURL: receiverBaseURL
            )
            let missingBlobHashes = Array(NSOrderedSet(array: planResponse.missingBlobHashes)) as? [String] ?? []

            for (index, blobHash) in missingBlobHashes.enumerated() {
                guard let blob = preparedSync.stagedBlobs[blobHash] else {
                    throw NSError(domain: "RemoteSyncManager", code: 9, userInfo: [
                        NSLocalizedDescriptionKey: "Receiver requested an unknown blob \(blobHash).",
                    ])
                }

                sendProgress = BridgeProgress(
                    title: "Sending health data…",
                    detail: "Uploading blob \(index + 1) of \(missingBlobHashes.count).",
                    completedUnitCount: 4,
                    totalUnitCount: 5
                )
                let _: BlobUploadResponse = try await sendBinaryRequest(
                    path: "\(RemoteSyncConstants.endpointPath)/_blob/\(blobHash)",
                    method: "PUT",
                    body: blob.data,
                    contentType: "application/octet-stream",
                    baseURL: receiverBaseURL
                )
            }

            sendProgress = BridgeProgress(
                title: "Sending health data…",
                detail: "Committing canonical manifest.",
                completedUnitCount: 4,
                totalUnitCount: 5
            )
            let commitResponse: RemoteSyncCommitResponse = try await sendRequest(
                path: "\(RemoteSyncConstants.endpointPath)/_commit",
                method: "POST",
                body: RemoteSyncCommitRequest(
                    replicationId: preparedSync.replicationId,
                    lastSequence: preparedSync.sequence,
                    snapshot: preparedSync.manifest
                ),
                baseURL: receiverBaseURL
            )

            replicationState = preparedSync.nextState
            try replicationStateStore.saveValue(replicationState)
            sendProgress = BridgeProgress(
                title: "Sending health data…",
                detail: "Receiver checkpoint updated.",
                completedUnitCount: 5,
                totalUnitCount: 5
            )

            lastSummary = [
                "Committed canonical sync sequence \(commitResponse.lastSequence).",
                "Manifest blobs: \(preparedSync.blobCount).",
                "Uploaded missing blobs: \(missingBlobHashes.count).",
                "Total staged blob bytes: \(preparedSync.totalBlobBytes).",
                preparedSync.changed ? "Local snapshot changed." : "Local snapshot unchanged; receiver state was reconciled.",
                preparedSync.recoveredSenderState ? "Recovered sender sequence from receiver checkpoint." : "",
            ]
            .filter { !$0.isEmpty }
            .joined(separator: " ")
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
        if candidates.isEmpty {
            probeFailures.append("No probeable Tailscale DNS or IPv4 address was present in the device API record.")
        }
        for candidate in candidates {
            do {
                let status = try await probeReceiverStatus(baseURL: candidate)

                guard status.protocolVersion == RemoteSyncConstants.protocolVersion,
                      status.schema == RemoteSyncConstants.schema else {
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
        var request = URLRequest(url: resolvedURL(for: RemoteSyncConstants.endpointPath, baseURL: baseURL))
        request.httpMethod = "GET"
        request.timeoutInterval = 5
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await urlSession.data(for: request)
        try validateHTTPResponse(response, data: data)
        return try JSONDecoder().decode(RemoteSyncStatusResponse.self, from: data)
    }

    private static func percentEncodedPathComponent(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? value
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

    private func sendBinaryRequest<ResponseBody: Decodable>(
        path: String,
        method: String,
        body: Data,
        contentType: String,
        baseURL: URL
    ) async throws -> ResponseBody {
        var request = URLRequest(url: resolvedURL(for: path, baseURL: baseURL))
        request.httpMethod = method
        request.httpBody = body
        request.timeoutInterval = 120
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
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

private struct BlobUploadResponse: Decodable {
    let ok: Bool
    let blobHash: String
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
        normalizedIPv4Addresses.first
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

        return !probeHostCandidates.isEmpty
    }

    var receiverCandidateBaseURLs: [URL] {
        probeHostCandidates.flatMap { host in
            [8788].compactMap { port in
                URL(string: "http://\(host):\(port)")
            }
        }
    }

    private var probeHostCandidates: [String] {
        var values: [String] = []

        values.append(contentsOf: normalizedIPv4Addresses)

        if let normalizedDNSName {
            values.append(normalizedDNSName)
        }

        // Only fall back to non-MagicDNS hostnames when there is no Tailscale IP or
        // explicit DNS name. Plain local hostnames can resolve outside the tailnet and
        // cause false-negative discovery timeouts.
        if values.isEmpty {
            if let normalizedName = normalizedHostCandidate(name) {
                values.append(normalizedName)
            }

            if let normalizedHostname = normalizedHostCandidate(hostname) {
                values.append(normalizedHostname)
            }
        }

        var seen = Set<String>()
        return values.filter { candidate in
            guard !candidate.isEmpty else {
                return false
            }

            if seen.contains(candidate) {
                return false
            }

            seen.insert(candidate)
            return true
        }
    }

    private var normalizedIPv4Addresses: [String] {
        (addresses ?? []).compactMap { address in
            let rawAddress = address.split(separator: "/", maxSplits: 1, omittingEmptySubsequences: true).first.map(String.init) ?? address
            guard rawAddress.contains(".") else {
                return nil
            }

            return rawAddress
        }
    }

    private func normalizedHostCandidate(_ rawValue: String?) -> String? {
        guard let rawValue else {
            return nil
        }

        let trimmed = rawValue.trimmingCharacters(in: CharacterSet(charactersIn: "."))
        guard !trimmed.isEmpty else {
            return nil
        }

        if trimmed.contains(".") {
            return trimmed
        }

        // Prefer fully-qualified MagicDNS names when available. Plain hostnames can still
        // work on some tailnets because Tailscale search domains are applied locally.
        return trimmed
    }
}
