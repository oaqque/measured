import Foundation
import HealthKit

@MainActor
final class HealthDataSyncEngine: ObservableObject {
    @Published private(set) var collections: [String: BridgeHealthCollection] = [:]
    @Published private(set) var isSyncing = false
    @Published private(set) var lastError: String?
    @Published private(set) var lastSyncSummary: String?

    var totalSampleCount: Int {
        collections.values.reduce(0) { $0 + $1.samples.count }
    }

    static var readTypes: Set<HKObjectType> {
        HealthKitTypeRegistry.readTypes
    }

    func syncSamples(using healthStore: HKHealthStore) async {
        isSyncing = true
        defer { isSyncing = false }

        let descriptors = HealthKitTypeRegistry.collectionDescriptors
        let preferredUnits = await preferredQuantityUnits(for: descriptors, using: healthStore)
        var nextCollections: [String: BridgeHealthCollection] = [:]
        var failureMessages: [String] = []

        for descriptor in descriptors {
            let objectType = descriptor.objectType
            nextCollections[descriptor.key] = emptyCollection(for: descriptor, objectType: objectType)

            guard let objectType else {
                failureMessages.append("\(descriptor.displayName): unavailable on this device or SDK build")
                continue
            }

            if descriptor.requiresPerObjectAuthorization {
                continue
            }

            do {
                let collection: BridgeHealthCollection
                switch descriptor.queryStrategy {
                case .activitySummary:
                    collection = try await activitySummaryCollection(for: descriptor, using: healthStore)
                case .category:
                    guard let categoryType = objectType as? HKCategoryType else {
                        continue
                    }
                    collection = try await categoryCollection(for: descriptor, type: categoryType, using: healthStore)
                case .characteristic:
                    collection = try characteristicCollection(for: descriptor, using: healthStore)
                case .quantity:
                    guard let quantityType = objectType as? HKQuantityType else {
                        continue
                    }
                    collection = try await quantityCollection(
                        for: descriptor,
                        type: quantityType,
                        preferredUnits: preferredUnits,
                        using: healthStore
                    )
                case .sample:
                    guard let sampleType = objectType as? HKSampleType else {
                        continue
                    }
                    collection = try await sampleCollection(for: descriptor, type: sampleType, using: healthStore)
                }

                nextCollections[descriptor.key] = collection
            } catch {
                failureMessages.append("\(descriptor.displayName): \(error.localizedDescription)")
            }
        }

        collections = nextCollections
        let nonEmptyCollectionCount = nextCollections.values.filter { !$0.samples.isEmpty }.count
        lastSyncSummary = "Loaded \(totalSampleCount) samples across \(nonEmptyCollectionCount) non-empty collections. Registry covers \(descriptors.count) HealthKit collections."
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

    private func quantityCollection(
        for descriptor: HealthKitCollectionDescriptor,
        type: HKQuantityType,
        preferredUnits: [HKQuantityType: HKUnit],
        using healthStore: HKHealthStore
    ) async throws -> BridgeHealthCollection {
        let samples = try await healthStore.samples(of: type).compactMap { $0 as? HKQuantitySample }
        let unit = descriptor.quantityIdentifier.flatMap(HealthKitTypeRegistry.fixedUnit(for:)) ?? preferredUnits[type]

        return BridgeHealthCollection(
            key: descriptor.key,
            kind: descriptor.kind,
            displayName: descriptor.displayName,
            unit: unit?.unitString,
            objectTypeIdentifier: type.identifier,
            queryStrategy: descriptor.queryStrategy.exportValue,
            requiresPerObjectAuthorization: type.requiresPerObjectAuthorization(),
            samples: samples.map { sample in
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
        )
    }

    private func categoryCollection(
        for descriptor: HealthKitCollectionDescriptor,
        type: HKCategoryType,
        using healthStore: HKHealthStore
    ) async throws -> BridgeHealthCollection {
        let samples = try await healthStore.samples(of: type).compactMap { $0 as? HKCategorySample }

        return BridgeHealthCollection(
            key: descriptor.key,
            kind: descriptor.kind,
            displayName: descriptor.displayName,
            unit: nil,
            objectTypeIdentifier: type.identifier,
            queryStrategy: descriptor.queryStrategy.exportValue,
            requiresPerObjectAuthorization: type.requiresPerObjectAuthorization(),
            samples: samples.map { sample in
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
        )
    }

    private func sampleCollection(
        for descriptor: HealthKitCollectionDescriptor,
        type: HKSampleType,
        using healthStore: HKHealthStore
    ) async throws -> BridgeHealthCollection {
        let samples = try await healthStore.samples(of: type)

        return BridgeHealthCollection(
            key: descriptor.key,
            kind: descriptor.kind,
            displayName: descriptor.displayName,
            unit: nil,
            objectTypeIdentifier: type.identifier,
            queryStrategy: descriptor.queryStrategy.exportValue,
            requiresPerObjectAuthorization: type.requiresPerObjectAuthorization(),
            samples: samples.map { sample in
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
}

private extension HKHealthStore {
    func samples(of type: HKSampleType) async throws -> [HKSample] {
        try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: type,
                predicate: nil,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)]
            ) { _, samples, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                continuation.resume(returning: samples ?? [])
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
