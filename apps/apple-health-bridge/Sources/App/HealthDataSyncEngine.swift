import Foundation
import HealthKit

@MainActor
final class HealthDataSyncEngine: ObservableObject {
    @Published private(set) var collections: [String: BridgeHealthCollection] = [:]
    @Published private(set) var isRestoringCache = true
    @Published private(set) var isSyncing = false
    @Published private(set) var lastError: String?
    @Published private(set) var lastSyncSummary: String?

    private let legacyCollectionStore = BridgeFileStore<[String: BridgeHealthCollection]>(filename: "collections.json")
    private let userDefaults: UserDefaults
    private let collectionCacheVersionKey = "health-data-collection-cache-version"
    private let collectionCacheVersion = 2

    var totalSampleCount: Int {
        collections.values.reduce(0) { $0 + $1.samples.count }
    }

    static var readTypes: Set<HKObjectType> {
        HealthKitTypeRegistry.readTypes
    }

    init(userDefaults: UserDefaults = .standard) {
        self.userDefaults = userDefaults
        restorePersistedState()
    }

    func syncSamples(using healthStore: HKHealthStore) async {
        isSyncing = true
        defer { isSyncing = false }

        let descriptors = HealthKitTypeRegistry.collectionDescriptors
        let preferredUnits = await preferredQuantityUnits(for: descriptors, using: healthStore)
        var nextCollections = collections
        var failureMessages: [String] = []
        var skippedCollectionCount = 0

        for descriptor in descriptors {
            let objectType = descriptor.objectType
            let existingCollection = nextCollections[descriptor.key] ?? emptyCollection(for: descriptor, objectType: objectType)
            nextCollections[descriptor.key] = existingCollection

            guard let objectType else {
                failureMessages.append("\(descriptor.displayName): unavailable on this device or SDK build")
                continue
            }

            if descriptor.requiresPerObjectAuthorization {
                nextCollections[descriptor.key] = emptyCollection(for: descriptor, objectType: objectType)
                skippedCollectionCount += 1
                continue
            }

            guard HealthKitTypeRegistry.shouldAttemptSync(for: descriptor) else {
                nextCollections[descriptor.key] = emptyCollection(for: descriptor, objectType: objectType)
                skippedCollectionCount += 1
                continue
            }

            do {
                let collection: BridgeHealthCollection
                let newAnchor: HKQueryAnchor?
                let didChange: Bool
                switch descriptor.queryStrategy {
                case .activitySummary:
                    collection = try await activitySummaryCollection(for: descriptor, using: healthStore)
                    newAnchor = nil
                    didChange = collection != existingCollection
                case .category:
                    guard let categoryType = objectType as? HKCategoryType else {
                        continue
                    }
                    let result = try await categoryCollection(
                        for: descriptor,
                        type: categoryType,
                        existingCollection: existingCollection,
                        using: healthStore
                    )
                    collection = result.collection
                    newAnchor = result.newAnchor
                    didChange = result.didChange
                case .characteristic:
                    collection = try characteristicCollection(for: descriptor, using: healthStore)
                    newAnchor = nil
                    didChange = collection != existingCollection
                case .quantity:
                    guard let quantityType = objectType as? HKQuantityType else {
                        continue
                    }
                    let result = try await incrementalQuantityCollection(
                        for: descriptor,
                        type: quantityType,
                        existingCollection: existingCollection,
                        preferredUnits: preferredUnits,
                        using: healthStore
                    )
                    collection = result.collection
                    newAnchor = result.newAnchor
                    didChange = result.didChange
                case .sample:
                    guard let sampleType = objectType as? HKSampleType else {
                        continue
                    }
                    let result = try await incrementalSampleCollection(
                        for: descriptor,
                        type: sampleType,
                        existingCollection: existingCollection,
                        using: healthStore
                    )
                    collection = result.collection
                    newAnchor = result.newAnchor
                    didChange = result.didChange
                }

                nextCollections[descriptor.key] = collection
                if didChange {
                    try collectionStore(for: descriptor).saveValue(collection)
                }
                if descriptor.queryStrategy.usesAnchoredQueries {
                    try anchorStore(for: descriptor).saveAnchor(newAnchor)
                }
            } catch {
                failureMessages.append("\(descriptor.displayName): \(error.localizedDescription)")
            }
        }

        collections = nextCollections
        let nonEmptyCollectionCount = nextCollections.values.filter { !$0.samples.isEmpty }.count
        lastSyncSummary = "Loaded \(totalSampleCount) samples across \(nonEmptyCollectionCount) non-empty collections. Skipped \(skippedCollectionCount) collections that require unsupported or explicit authorization. Registry covers \(descriptors.count) HealthKit collections."
        lastError = failureMessages.isEmpty ? nil : failureMessages.joined(separator: "\n")
    }

    private func emptyCollection(
        for descriptor: HealthKitCollectionDescriptor,
        objectType: HKObjectType?
    ) -> BridgeHealthCollection {
        BridgeHealthCollection(
            key: descriptor.key,
            kind: descriptor.kind,
            displayName: descriptor.displayName,
            unit: nil,
            objectTypeIdentifier: objectType?.identifier,
            queryStrategy: descriptor.queryStrategy.exportValue,
            requiresPerObjectAuthorization: descriptor.requiresPerObjectAuthorization,
            samples: []
        )
    }

    private func incrementalQuantityCollection(
        for descriptor: HealthKitCollectionDescriptor,
        type: HKQuantityType,
        existingCollection: BridgeHealthCollection,
        preferredUnits: [HKQuantityType: HKUnit],
        using healthStore: HKHealthStore
    ) async throws -> AnchoredCollectionSyncResult {
        let unit = descriptor.quantityIdentifier.flatMap(HealthKitTypeRegistry.fixedUnit(for:)) ?? preferredUnits[type]
        let store = collectionStore(for: descriptor)
        let storedAnchor = try collectionAnchor(for: descriptor)
        let result = try await healthStore.anchoredSamples(of: type, anchor: storedAnchor)

        if result.samples.isEmpty, result.deletedObjects.isEmpty, store.exists {
            return AnchoredCollectionSyncResult(
                collection: existingCollection,
                newAnchor: result.newAnchor,
                didChange: false
            )
        }

        var samplesById = Dictionary(uniqueKeysWithValues: existingCollection.samples.map { ($0.sampleId, $0) })

        for deletedObject in result.deletedObjects {
            samplesById.removeValue(forKey: deletedObject.uuid.uuidString)
        }

        for sample in result.samples.compactMap({ $0 as? HKQuantitySample }) {
            samplesById[sample.uuid.uuidString] = quantityBridgeSample(for: sample, unit: unit)
        }

        return AnchoredCollectionSyncResult(
            collection: BridgeHealthCollection(
                key: descriptor.key,
                kind: descriptor.kind,
                displayName: descriptor.displayName,
                unit: unit?.unitString,
                objectTypeIdentifier: type.identifier,
                queryStrategy: descriptor.queryStrategy.exportValue,
                requiresPerObjectAuthorization: type.requiresPerObjectAuthorization(),
                samples: sortBridgeSamples(samplesById.values)
            ),
            newAnchor: result.newAnchor,
            didChange: true
        )
    }

    private func categoryCollection(
        for descriptor: HealthKitCollectionDescriptor,
        type: HKCategoryType,
        existingCollection: BridgeHealthCollection,
        using healthStore: HKHealthStore
    ) async throws -> AnchoredCollectionSyncResult {
        let store = collectionStore(for: descriptor)
        let storedAnchor = try collectionAnchor(for: descriptor)
        let result = try await healthStore.anchoredSamples(of: type, anchor: storedAnchor)

        if result.samples.isEmpty, result.deletedObjects.isEmpty, store.exists {
            return AnchoredCollectionSyncResult(
                collection: existingCollection,
                newAnchor: result.newAnchor,
                didChange: false
            )
        }

        var samplesById = Dictionary(uniqueKeysWithValues: existingCollection.samples.map { ($0.sampleId, $0) })

        for deletedObject in result.deletedObjects {
            samplesById.removeValue(forKey: deletedObject.uuid.uuidString)
        }

        for sample in result.samples.compactMap({ $0 as? HKCategorySample }) {
            samplesById[sample.uuid.uuidString] = categoryBridgeSample(for: sample)
        }

        return AnchoredCollectionSyncResult(
            collection: BridgeHealthCollection(
                key: descriptor.key,
                kind: descriptor.kind,
                displayName: descriptor.displayName,
                unit: nil,
                objectTypeIdentifier: type.identifier,
                queryStrategy: descriptor.queryStrategy.exportValue,
                requiresPerObjectAuthorization: type.requiresPerObjectAuthorization(),
                samples: sortBridgeSamples(samplesById.values)
            ),
            newAnchor: result.newAnchor,
            didChange: true
        )
    }

    private func incrementalSampleCollection(
        for descriptor: HealthKitCollectionDescriptor,
        type: HKSampleType,
        existingCollection: BridgeHealthCollection,
        using healthStore: HKHealthStore
    ) async throws -> AnchoredCollectionSyncResult {
        let store = collectionStore(for: descriptor)
        let storedAnchor = try collectionAnchor(for: descriptor)
        let result = try await healthStore.anchoredSamples(of: type, anchor: storedAnchor)

        if result.samples.isEmpty, result.deletedObjects.isEmpty, store.exists {
            return AnchoredCollectionSyncResult(
                collection: existingCollection,
                newAnchor: result.newAnchor,
                didChange: false
            )
        }

        var samplesById = Dictionary(uniqueKeysWithValues: existingCollection.samples.map { ($0.sampleId, $0) })

        for deletedObject in result.deletedObjects {
            samplesById.removeValue(forKey: deletedObject.uuid.uuidString)
        }

        for sample in result.samples {
            samplesById[sample.uuid.uuidString] = genericBridgeSample(for: sample)
        }

        return AnchoredCollectionSyncResult(
            collection: BridgeHealthCollection(
                key: descriptor.key,
                kind: descriptor.kind,
                displayName: descriptor.displayName,
                unit: nil,
                objectTypeIdentifier: type.identifier,
                queryStrategy: descriptor.queryStrategy.exportValue,
                requiresPerObjectAuthorization: type.requiresPerObjectAuthorization(),
                samples: sortBridgeSamples(samplesById.values)
            ),
            newAnchor: result.newAnchor,
            didChange: true
        )
    }

    private func characteristicCollection(
        for descriptor: HealthKitCollectionDescriptor,
        using healthStore: HKHealthStore
    ) throws -> BridgeHealthCollection {
        let textValue = try characteristicValue(for: descriptor.key, using: healthStore)
        let objectType = descriptor.objectType

        return BridgeHealthCollection(
            key: descriptor.key,
            kind: descriptor.kind,
            displayName: descriptor.displayName,
            unit: nil,
            objectTypeIdentifier: objectType?.identifier,
            queryStrategy: descriptor.queryStrategy.exportValue,
            requiresPerObjectAuthorization: objectType?.requiresPerObjectAuthorization(),
            samples: textValue.map { value in
                [
                    BridgeHealthSample(
                        sampleId: descriptor.key,
                        startDate: nil,
                        endDate: nil,
                        numericValue: nil,
                        categoryValue: nil,
                        textValue: value,
                        payload: nil,
                        source: nil,
                        metadata: nil
                    ),
                ]
            } ?? []
        )
    }

    private func activitySummaryCollection(
        for descriptor: HealthKitCollectionDescriptor,
        using healthStore: HKHealthStore
    ) async throws -> BridgeHealthCollection {
        let summaries = try await healthStore.activitySummaries()
        let calendar = Calendar(identifier: .gregorian)

        return BridgeHealthCollection(
            key: descriptor.key,
            kind: descriptor.kind,
            displayName: descriptor.displayName,
            unit: nil,
            objectTypeIdentifier: descriptor.objectType?.identifier,
            queryStrategy: descriptor.queryStrategy.exportValue,
            requiresPerObjectAuthorization: descriptor.objectType?.requiresPerObjectAuthorization(),
            samples: summaries.map { summary in
                let dateComponents = summary.dateComponents(for: calendar)
                let summaryDate = calendar.date(from: dateComponents)
                return BridgeHealthSample(
                    sampleId: [
                        dateComponents.year,
                        dateComponents.month,
                        dateComponents.day,
                    ]
                    .compactMap { $0.map(String.init) }
                    .joined(separator: "-"),
                    startDate: summaryDate,
                    endDate: summaryDate,
                    numericValue: nil,
                    categoryValue: nil,
                    textValue: nil,
                    payload: [
                        "activeEnergyBurned": stringifyQuantity(summary.activeEnergyBurned),
                        "activeEnergyBurnedGoal": stringifyQuantity(summary.activeEnergyBurnedGoal),
                        "appleExerciseTime": stringifyQuantity(summary.appleExerciseTime),
                        "appleExerciseTimeGoal": stringifyQuantity(summary.appleExerciseTimeGoal),
                        "appleStandHours": stringifyQuantity(summary.appleStandHours),
                        "appleStandHoursGoal": stringifyQuantity(summary.appleStandHoursGoal),
                    ],
                    source: nil,
                    metadata: nil
                )
            }
        )
    }

    private func characteristicValue(for key: String, using healthStore: HKHealthStore) throws -> String? {
        switch key {
        case "activityMoveMode":
            return String(describing: try healthStore.activityMoveMode().activityMoveMode)
        case "biologicalSex":
            return String(describing: try healthStore.biologicalSex().biologicalSex)
        case "bloodType":
            return String(describing: try healthStore.bloodType().bloodType)
        case "dateOfBirth":
            let components = try healthStore.dateOfBirthComponents()
            return [
                components.year,
                components.month,
                components.day,
            ]
            .compactMap { $0.map(String.init) }
            .joined(separator: "-")
        case "fitzpatrickSkinType":
            return String(describing: try healthStore.fitzpatrickSkinType().skinType)
        case "wheelchairUse":
            return String(describing: try healthStore.wheelchairUse().wheelchairUse)
        default:
            return nil
        }
    }

    private func anchorStore(for descriptor: HealthKitCollectionDescriptor) -> PersistentHealthKitAnchorStore {
        PersistentHealthKitAnchorStore(anchorKey: "collection-anchor-\(descriptor.key)")
    }

    private func collectionStore(for descriptor: HealthKitCollectionDescriptor) -> BridgeFileStore<BridgeHealthCollection> {
        BridgeFileStore(filename: "collections/\(descriptor.key).json")
    }

    private func collectionAnchor(for descriptor: HealthKitCollectionDescriptor) throws -> HKQueryAnchor? {
        let store = collectionStore(for: descriptor)
        guard store.exists else {
            return nil
        }

        return try anchorStore(for: descriptor).loadAnchor()
    }

    private func migrateCollectionPersistenceIfNeeded() {
        guard userDefaults.integer(forKey: collectionCacheVersionKey) < collectionCacheVersion else {
            return
        }

        try? legacyCollectionStore.saveValue(nil)

        for descriptor in HealthKitTypeRegistry.collectionDescriptors {
            try? collectionStore(for: descriptor).saveValue(nil)
            try? anchorStore(for: descriptor).saveAnchor(nil)
        }

        userDefaults.set(collectionCacheVersion, forKey: collectionCacheVersionKey)
    }

    private func restorePersistedState() {
        let userDefaults = self.userDefaults

        Task.detached(priority: .userInitiated) {
            Self.migrateCollectionPersistenceIfNeeded(userDefaults: userDefaults)
            let restoredCollections = Self.loadPersistedCollections()

            await MainActor.run {
                self.collections = restoredCollections
                self.isRestoringCache = false
            }
        }
    }

    nonisolated private static func loadPersistedCollections() -> [String: BridgeHealthCollection] {
        HealthKitTypeRegistry.collectionDescriptors.reduce(into: [:]) { partialResult, descriptor in
            if let collection = try? BridgeFileStore<BridgeHealthCollection>(
                filename: "collections/\(descriptor.key).json"
            ).loadValue() {
                partialResult[descriptor.key] = collection
            }
        }
    }

    nonisolated private static func migrateCollectionPersistenceIfNeeded(userDefaults: UserDefaults) {
        let collectionCacheVersionKey = "health-data-collection-cache-version"
        let collectionCacheVersion = 2

        guard userDefaults.integer(forKey: collectionCacheVersionKey) < collectionCacheVersion else {
            return
        }

        try? BridgeFileStore<[String: BridgeHealthCollection]>(filename: "collections.json").saveValue(nil)

        for descriptor in HealthKitTypeRegistry.collectionDescriptors {
            try? BridgeFileStore<BridgeHealthCollection>(filename: "collections/\(descriptor.key).json").saveValue(nil)
            try? PersistentHealthKitAnchorStore(anchorKey: "collection-anchor-\(descriptor.key)", userDefaults: userDefaults)
                .saveAnchor(nil)
        }

        userDefaults.set(collectionCacheVersion, forKey: collectionCacheVersionKey)
    }
}

private extension HKHealthStore {
    func anchoredSamples(
        of type: HKSampleType,
        anchor: HKQueryAnchor?
    ) async throws -> (samples: [HKSample], deletedObjects: [HKDeletedObject], newAnchor: HKQueryAnchor?) {
        try await withCheckedThrowingContinuation { continuation in
            let query = HKAnchoredObjectQuery(
                type: type,
                predicate: nil,
                anchor: anchor,
                limit: HKObjectQueryNoLimit,
            ) { _, samples, deletedObjects, newAnchor, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                continuation.resume(
                    returning: (
                        samples: samples ?? [],
                        deletedObjects: deletedObjects ?? [],
                        newAnchor: newAnchor
                    )
                )
            }

            execute(query)
        }
    }

    func preferredUnits(for quantityTypes: Set<HKQuantityType>) async throws -> [HKQuantityType: HKUnit] {
        guard !quantityTypes.isEmpty else {
            return [:]
        }

        return try await withCheckedThrowingContinuation { continuation in
            preferredUnits(for: quantityTypes) { units, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                continuation.resume(returning: units)
            }
        }
    }

    func activitySummaries() async throws -> [HKActivitySummary] {
        try await withCheckedThrowingContinuation { continuation in
            let query = HKActivitySummaryQuery(predicate: nil) { _, summaries, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                continuation.resume(returning: summaries ?? [])
            }

            execute(query)
        }
    }
}

private extension HKSample {
    var exportSource: AppleHealthExportSource {
        AppleHealthExportSource(
            bundleIdentifier: sourceRevision.source.bundleIdentifier,
            name: sourceRevision.source.name,
            deviceName: device?.name,
            deviceModel: device?.model
        )
    }

    var normalizedMetadata: [String: String]? {
        guard let metadata, !metadata.isEmpty else {
            return nil
        }

        let normalized = metadata.reduce(into: [String: String]()) { partialResult, item in
            partialResult[item.key] = stringifyMetadataValue(item.value)
        }

        return normalized.isEmpty ? nil : normalized
    }
}

private extension HealthKitCollectionQueryStrategy {
    var exportValue: String {
        switch self {
        case .activitySummary:
            return "activitySummary"
        case .category:
            return "category"
        case .characteristic:
            return "characteristic"
        case .quantity:
            return "quantity"
        case .sample:
            return "sample"
        }
    }

    var usesAnchoredQueries: Bool {
        switch self {
        case .category, .quantity, .sample:
            return true
        case .activitySummary, .characteristic:
            return false
        }
    }
}

private struct AnchoredCollectionSyncResult {
    let collection: BridgeHealthCollection
    let newAnchor: HKQueryAnchor?
    let didChange: Bool
}

private func preferredQuantityUnits(
    for descriptors: [HealthKitCollectionDescriptor],
    using healthStore: HKHealthStore
) async -> [HKQuantityType: HKUnit] {
    let preferredQuantityTypes = Set(
        descriptors.compactMap { descriptor -> HKQuantityType? in
            guard descriptor.queryStrategy == .quantity else {
                return nil
            }

            guard let quantityIdentifier = descriptor.quantityIdentifier else {
                return nil
            }

            guard HealthKitTypeRegistry.fixedUnit(for: quantityIdentifier) == nil else {
                return nil
            }

            return descriptor.objectType as? HKQuantityType
        }
    )

    return (try? await healthStore.preferredUnits(for: preferredQuantityTypes)) ?? [:]
}

private func quantityBridgeSample(for sample: HKQuantitySample, unit: HKUnit?) -> BridgeHealthSample {
    BridgeHealthSample(
        sampleId: sample.uuid.uuidString,
        startDate: sample.startDate,
        endDate: sample.endDate,
        numericValue: unit.map { sample.quantity.doubleValue(for: $0) },
        categoryValue: nil,
        textValue: unit == nil ? sample.quantity.description : nil,
        payload: nil,
        source: sample.exportSource,
        metadata: sample.normalizedMetadata
    )
}

private func categoryBridgeSample(for sample: HKCategorySample) -> BridgeHealthSample {
    BridgeHealthSample(
        sampleId: sample.uuid.uuidString,
        startDate: sample.startDate,
        endDate: sample.endDate,
        numericValue: nil,
        categoryValue: sample.value,
        textValue: nil,
        payload: nil,
        source: sample.exportSource,
        metadata: sample.normalizedMetadata
    )
}

private func genericBridgeSample(for sample: HKSample) -> BridgeHealthSample {
    BridgeHealthSample(
        sampleId: sample.uuid.uuidString,
        startDate: sample.startDate,
        endDate: sample.endDate,
        numericValue: nil,
        categoryValue: nil,
        textValue: nil,
        payload: genericPayload(for: sample),
        source: sample.exportSource,
        metadata: sample.normalizedMetadata
    )
}

private func sortBridgeSamples<S: Sequence>(_ samples: S) -> [BridgeHealthSample] where S.Element == BridgeHealthSample {
    Array(samples).sorted {
        (($0.startDate ?? .distantPast), $0.sampleId) > (($1.startDate ?? .distantPast), $1.sampleId)
    }
}

private func genericPayload(for sample: HKSample) -> [String: String]? {
    var payload = ["sampleClass": String(describing: type(of: sample))]

    if let correlation = sample as? HKCorrelation {
        payload["memberCount"] = String(correlation.objects.count)
        let memberTypes = Set(correlation.objects.map { $0.sampleType.identifier }).sorted()
        if !memberTypes.isEmpty {
            payload["memberTypes"] = memberTypes.joined(separator: ",")
        }
    }

    return payload.isEmpty ? nil : payload
}

private func stringifyMetadataValue(_ value: Any) -> String {
    if let string = value as? String {
        return string
    }
    if let number = value as? NSNumber {
        return number.stringValue
    }
    if let date = value as? Date {
        return date.ISO8601Format()
    }

    return String(describing: value)
}

private func stringifyQuantity(_ quantity: HKQuantity?) -> String {
    quantity?.description ?? ""
}
