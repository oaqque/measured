import Foundation
import HealthKit

struct GeneratedHealthKitCatalogEntry<Identifier> {
    let symbol: String
    let displayName: String
    let identifier: Identifier
}

enum HealthKitCollectionQueryStrategy: Equatable {
    case activitySummary
    case category
    case characteristic
    case quantity
    case sample
}

struct HealthKitAuthorizationStage {
    let key: String
    let displayName: String
    let readTypes: Set<HKObjectType>
}

struct HealthKitCollectionDescriptor {
    let key: String
    let displayName: String
    let kind: String
    let queryStrategy: HealthKitCollectionQueryStrategy
    let quantityIdentifier: HKQuantityTypeIdentifier?
    private let objectTypeProvider: () -> HKObjectType?

    init(
        key: String,
        displayName: String,
        kind: String,
        queryStrategy: HealthKitCollectionQueryStrategy,
        quantityIdentifier: HKQuantityTypeIdentifier? = nil,
        objectTypeProvider: @escaping () -> HKObjectType?
    ) {
        self.key = key
        self.displayName = displayName
        self.kind = kind
        self.queryStrategy = queryStrategy
        self.quantityIdentifier = quantityIdentifier
        self.objectTypeProvider = objectTypeProvider
    }

    var objectType: HKObjectType? {
        objectTypeProvider()
    }

    var sampleType: HKSampleType? {
        objectType as? HKSampleType
    }

    var requiresPerObjectAuthorization: Bool {
        objectType?.requiresPerObjectAuthorization() ?? false
    }
}

enum HealthKitTypeRegistry {
    static var collectionDescriptors: [HealthKitCollectionDescriptor] {
        characteristicDescriptors +
        quantityDescriptors +
        categoryDescriptors +
        correlationDescriptors +
        clinicalDescriptors +
        documentDescriptors +
        specialSampleDescriptors +
        [activitySummaryDescriptor]
    }

    static var readTypes: Set<HKObjectType> {
        Set(
            collectionDescriptors.compactMap { descriptor in
                guard shouldAttemptSync(for: descriptor) else {
                    return nil
                }

                return descriptor.objectType
            }
        )
    }

    static var authorizationReadTypes: Set<HKObjectType> {
        Set(
            collectionDescriptors.compactMap { descriptor in
                guard !descriptor.requiresPerObjectAuthorization else {
                    return nil
                }

                // Keep the initial authorization request to the core types that
                // are broadly readable without additional Health record or
                // special-sample constraints. The app can still handle
                // unauthorized collections gracefully during sync.
                switch descriptor.queryStrategy {
                case .characteristic, .quantity, .category, .activitySummary:
                    return descriptor.objectType
                case .sample:
                    return nil
                }
            }
        )
    }

    static var authorizationStages: [HealthKitAuthorizationStage] {
        [
            HealthKitAuthorizationStage(
                key: "core",
                displayName: "Core Health Data",
                readTypes: coreAuthorizationReadTypes
            ),
            HealthKitAuthorizationStage(
                key: "correlations",
                displayName: "Correlations",
                readTypes: authorizationReadTypes(
                    matching: collectionDescriptors.filter {
                        $0.kind == "correlation" && supportsStagedAuthorization($0)
                    }
                )
            ),
            HealthKitAuthorizationStage(
                key: "specialSamples",
                displayName: "Special Samples",
                readTypes: authorizationReadTypes(
                    matching: collectionDescriptors.filter {
                        switch $0.kind {
                        case "clinicalRecord", "document":
                            return false
                        case "correlation", "characteristic", "quantity", "category", "activitySummary":
                            return false
                        default:
                            return $0.queryStrategy == .sample && supportsStagedAuthorization($0)
                        }
                    }
                )
            ),
        ]
        .filter { !$0.readTypes.isEmpty }
    }

    private static var coreAuthorizationReadTypes: Set<HKObjectType> {
        authorizationReadTypes(
            matching: collectionDescriptors.filter {
                switch $0.queryStrategy {
                case .characteristic, .quantity, .category, .activitySummary:
                    return true
                case .sample:
                    return false
                }
            }
        )
    }

    private static func authorizationReadTypes(
        matching descriptors: [HealthKitCollectionDescriptor]
    ) -> Set<HKObjectType> {
        Set(
            descriptors.compactMap { descriptor in
                guard !descriptor.requiresPerObjectAuthorization else {
                    return nil
                }

                guard descriptor.kind != "clinicalRecord", descriptor.kind != "document" else {
                    return nil
                }

                return descriptor.objectType
            }
        )
    }

    private static func supportsStagedAuthorization(_ descriptor: HealthKitCollectionDescriptor) -> Bool {
        switch descriptor.key {
        case "bloodPressure", "food", "medicationDoseEvent":
            return false
        default:
            return true
        }
    }

    static func shouldAttemptSync(for descriptor: HealthKitCollectionDescriptor) -> Bool {
        guard !descriptor.requiresPerObjectAuthorization else {
            return false
        }

        guard descriptor.kind != "clinicalRecord", descriptor.kind != "document" else {
            return false
        }

        return supportsStagedAuthorization(descriptor)
    }

    private static var characteristicDescriptors: [HealthKitCollectionDescriptor] {
        GeneratedHealthKitCatalog.characteristicEntries.map { entry in
            HealthKitCollectionDescriptor(
                key: entry.symbol,
                displayName: entry.displayName,
                kind: "characteristic",
                queryStrategy: .characteristic
            ) {
                HKObjectType.characteristicType(forIdentifier: entry.identifier)
            }
        }
    }

    private static var quantityDescriptors: [HealthKitCollectionDescriptor] {
        GeneratedHealthKitCatalog.quantityEntries.map { entry in
            HealthKitCollectionDescriptor(
                key: entry.symbol,
                displayName: entry.displayName,
                kind: "quantity",
                queryStrategy: .quantity,
                quantityIdentifier: entry.identifier
            ) {
                HKObjectType.quantityType(forIdentifier: entry.identifier)
            }
        }
    }

    private static var categoryDescriptors: [HealthKitCollectionDescriptor] {
        GeneratedHealthKitCatalog.categoryEntries.map { entry in
            HealthKitCollectionDescriptor(
                key: entry.symbol,
                displayName: entry.displayName,
                kind: "category",
                queryStrategy: .category
            ) {
                HKObjectType.categoryType(forIdentifier: entry.identifier)
            }
        }
    }

    private static var correlationDescriptors: [HealthKitCollectionDescriptor] {
        GeneratedHealthKitCatalog.correlationEntries.map { entry in
            HealthKitCollectionDescriptor(
                key: entry.symbol,
                displayName: entry.displayName,
                kind: "correlation",
                queryStrategy: .sample
            ) {
                HKObjectType.correlationType(forIdentifier: entry.identifier)
            }
        }
    }

    private static var clinicalDescriptors: [HealthKitCollectionDescriptor] {
        GeneratedHealthKitCatalog.clinicalEntries.map { entry in
            HealthKitCollectionDescriptor(
                key: entry.symbol,
                displayName: entry.displayName,
                kind: "clinicalRecord",
                queryStrategy: .sample
            ) {
                HKObjectType.clinicalType(forIdentifier: entry.identifier)
            }
        }
    }

    private static var documentDescriptors: [HealthKitCollectionDescriptor] {
        GeneratedHealthKitCatalog.documentEntries.map { entry in
            HealthKitCollectionDescriptor(
                key: entry.symbol,
                displayName: entry.displayName,
                kind: "document",
                queryStrategy: .sample
            ) {
                HKObjectType.documentType(forIdentifier: entry.identifier)
            }
        }
    }

    private static var specialSampleDescriptors: [HealthKitCollectionDescriptor] {
        var output: [HealthKitCollectionDescriptor] = [
            HealthKitCollectionDescriptor(
                key: "audiogram",
                displayName: "Audiogram",
                kind: "audiogram",
                queryStrategy: .sample
            ) {
                HKObjectType.audiogramSampleType()
            },
            HealthKitCollectionDescriptor(
                key: "electrocardiogram",
                displayName: "Electrocardiogram",
                kind: "electrocardiogram",
                queryStrategy: .sample
            ) {
                HKObjectType.electrocardiogramType()
            },
            HealthKitCollectionDescriptor(
                key: "heartbeatSeries",
                displayName: "Heartbeat Series",
                kind: "series",
                queryStrategy: .sample
            ) {
                HKSeriesType.heartbeat()
            },
            HealthKitCollectionDescriptor(
                key: "visionPrescription",
                displayName: "Vision Prescription",
                kind: "visionPrescription",
                queryStrategy: .sample
            ) {
                HKObjectType.visionPrescriptionType()
            },
        ]

        if #available(iOS 18.0, *) {
            output.append(
                HealthKitCollectionDescriptor(
                    key: "stateOfMind",
                    displayName: "State Of Mind",
                    kind: "stateOfMind",
                    queryStrategy: .sample
                ) {
                    HKObjectType.stateOfMindType()
                }
            )
        }

        if #available(iOS 26.0, *) {
            output.append(
                HealthKitCollectionDescriptor(
                    key: "medicationDoseEvent",
                    displayName: "Medication Dose Event",
                    kind: "medicationDoseEvent",
                    queryStrategy: .sample
                ) {
                    HKObjectType.medicationDoseEventType()
                }
            )
            output.append(
                HealthKitCollectionDescriptor(
                    key: "userAnnotatedMedication",
                    displayName: "User Annotated Medication",
                    kind: "userAnnotatedMedication",
                    queryStrategy: .sample
                ) {
                    HKObjectType.userAnnotatedMedicationType()
                }
            )
        }

        return output
    }

    private static let activitySummaryDescriptor = HealthKitCollectionDescriptor(
        key: "activitySummary",
        displayName: "Activity Summary",
        kind: "activitySummary",
        queryStrategy: .activitySummary
    ) {
        HKObjectType.activitySummaryType()
    }

    static func fixedUnit(for identifier: HKQuantityTypeIdentifier) -> HKUnit? {
        switch identifier {
        case .stepCount, .pushCount, .swimmingStrokeCount, .flightsClimbed:
            return .count()
        case .distanceWalkingRunning, .distanceCycling:
            return .meter()
        case .activeEnergyBurned, .basalEnergyBurned:
            return .kilocalorie()
        case .heartRate, .restingHeartRate, .walkingHeartRateAverage, .heartRateRecoveryOneMinute:
            return .count().unitDivided(by: .minute())
        case .heartRateVariabilitySDNN:
            return .secondUnit(with: .milli)
        case .respiratoryRate:
            return .count().unitDivided(by: .minute())
        case .oxygenSaturation, .bodyFatPercentage:
            return .percent()
        case .vo2Max:
            return HKUnit(from: "ml/(kg*min)")
        case .bodyMass, .leanBodyMass:
            return .gramUnit(with: .kilo)
        case .bodyMassIndex:
            return .count()
        case .height:
            return .meter()
        case .appleExerciseTime, .appleStandTime, .appleMoveTime:
            return .minute()
        default:
            return nil
        }
    }
}
