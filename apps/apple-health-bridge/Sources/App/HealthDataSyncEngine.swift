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
        var output = Set<HKObjectType>()
        output.formUnion(quantityDescriptors.compactMap { HKObjectType.quantityType(forIdentifier: $0.identifier) })
        output.formUnion(categoryDescriptors.compactMap { HKObjectType.categoryType(forIdentifier: $0.identifier) })
        return output
    }

    func syncSamples(using healthStore: HKHealthStore) async {
        isSyncing = true
        defer { isSyncing = false }

        var nextCollections: [String: BridgeHealthCollection] = [:]
        var failureMessages: [String] = []

        for descriptor in Self.quantityDescriptors {
            guard let quantityType = HKObjectType.quantityType(forIdentifier: descriptor.identifier) else {
                continue
            }

            do {
                let samples = try await healthStore.quantitySamples(of: quantityType)
                nextCollections[descriptor.key] = BridgeHealthCollection(
                    key: descriptor.key,
                    kind: "quantity",
                    displayName: descriptor.displayName,
                    unit: descriptor.unit.unitString,
                    samples: samples.map { sample in
                        BridgeHealthSample(
                            sampleId: sample.uuid.uuidString,
                            startDate: sample.startDate,
                            endDate: sample.endDate,
                            numericValue: sample.quantity.doubleValue(for: descriptor.unit),
                            categoryValue: nil,
                            source: sample.exportSource,
                            metadata: sample.normalizedMetadata
                        )
                    }
                )
            } catch {
                failureMessages.append("\(descriptor.displayName): \(error.localizedDescription)")
            }
        }

        for descriptor in Self.categoryDescriptors {
            guard let categoryType = HKObjectType.categoryType(forIdentifier: descriptor.identifier) else {
                continue
            }

            do {
                let samples = try await healthStore.categorySamples(of: categoryType)
                nextCollections[descriptor.key] = BridgeHealthCollection(
                    key: descriptor.key,
                    kind: "category",
                    displayName: descriptor.displayName,
                    unit: nil,
                    samples: samples.map { sample in
                        BridgeHealthSample(
                            sampleId: sample.uuid.uuidString,
                            startDate: sample.startDate,
                            endDate: sample.endDate,
                            numericValue: nil,
                            categoryValue: sample.value,
                            source: sample.exportSource,
                            metadata: sample.normalizedMetadata
                        )
                    }
                )
            } catch {
                failureMessages.append("\(descriptor.displayName): \(error.localizedDescription)")
            }
        }

        collections = nextCollections
        let nonEmptyCollectionCount = nextCollections.values.filter { !$0.samples.isEmpty }.count
        lastSyncSummary = "Loaded \(totalSampleCount) samples across \(nonEmptyCollectionCount) health collections."
        lastError = failureMessages.isEmpty ? nil : failureMessages.joined(separator: "\n")
    }

    private static let quantityDescriptors: [QuantityDescriptor] = [
        .init(identifier: .stepCount, key: "stepCount", displayName: "Step Count", unit: .count()),
        .init(identifier: .distanceWalkingRunning, key: "distanceWalkingRunning", displayName: "Walking and Running Distance", unit: .meter()),
        .init(identifier: .distanceCycling, key: "distanceCycling", displayName: "Cycling Distance", unit: .meter()),
        .init(identifier: .activeEnergyBurned, key: "activeEnergyBurned", displayName: "Active Energy Burned", unit: .kilocalorie()),
        .init(identifier: .basalEnergyBurned, key: "basalEnergyBurned", displayName: "Basal Energy Burned", unit: .kilocalorie()),
        .init(identifier: .heartRate, key: "heartRate", displayName: "Heart Rate", unit: .count().unitDivided(by: .minute())),
        .init(identifier: .restingHeartRate, key: "restingHeartRate", displayName: "Resting Heart Rate", unit: .count().unitDivided(by: .minute())),
        .init(identifier: .walkingHeartRateAverage, key: "walkingHeartRateAverage", displayName: "Walking Heart Rate Average", unit: .count().unitDivided(by: .minute())),
        .init(identifier: .heartRateVariabilitySDNN, key: "heartRateVariabilitySDNN", displayName: "Heart Rate Variability", unit: .secondUnit(with: .milli)),
        .init(identifier: .respiratoryRate, key: "respiratoryRate", displayName: "Respiratory Rate", unit: .count().unitDivided(by: .minute())),
        .init(identifier: .oxygenSaturation, key: "oxygenSaturation", displayName: "Blood Oxygen Saturation", unit: .percent()),
        .init(identifier: .vo2Max, key: "vo2Max", displayName: "VO2 Max", unit: HKUnit(from: "ml/(kg*min)")),
        .init(identifier: .bodyMass, key: "bodyMass", displayName: "Body Mass", unit: .gramUnit(with: .kilo)),
        .init(identifier: .bodyFatPercentage, key: "bodyFatPercentage", displayName: "Body Fat Percentage", unit: .percent()),
        .init(identifier: .leanBodyMass, key: "leanBodyMass", displayName: "Lean Body Mass", unit: .gramUnit(with: .kilo)),
        .init(identifier: .bodyMassIndex, key: "bodyMassIndex", displayName: "Body Mass Index", unit: .count()),
        .init(identifier: .height, key: "height", displayName: "Height", unit: .meter()),
        .init(identifier: .flightsClimbed, key: "flightsClimbed", displayName: "Flights Climbed", unit: .count()),
        .init(identifier: .appleExerciseTime, key: "appleExerciseTime", displayName: "Apple Exercise Time", unit: .minute()),
        .init(identifier: .appleStandTime, key: "appleStandTime", displayName: "Apple Stand Time", unit: .minute()),
    ]

    private static let categoryDescriptors: [CategoryDescriptor] = [
        .init(identifier: .sleepAnalysis, key: "sleepAnalysis", displayName: "Sleep Analysis"),
        .init(identifier: .mindfulSession, key: "mindfulSession", displayName: "Mindful Session"),
        .init(identifier: .appleStandHour, key: "appleStandHour", displayName: "Apple Stand Hour"),
    ]
}

private struct QuantityDescriptor {
    let identifier: HKQuantityTypeIdentifier
    let key: String
    let displayName: String
    let unit: HKUnit
}

private struct CategoryDescriptor {
    let identifier: HKCategoryTypeIdentifier
    let key: String
    let displayName: String
}

private extension HKHealthStore {
    func quantitySamples(of type: HKQuantityType) async throws -> [HKQuantitySample] {
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

                continuation.resume(returning: (samples ?? []).compactMap { $0 as? HKQuantitySample })
            }

            execute(query)
        }
    }

    func categorySamples(of type: HKCategoryType) async throws -> [HKCategorySample] {
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

                continuation.resume(returning: (samples ?? []).compactMap { $0 as? HKCategorySample })
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
