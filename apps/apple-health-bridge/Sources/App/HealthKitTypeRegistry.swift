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
                guard !descriptor.requiresPerObjectAuthorization else {
                    return nil
                }

                return descriptor.objectType
            }
        )
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
