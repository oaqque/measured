#import <Foundation/Foundation.h>
#import <HealthKit/HealthKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface HealthKitExceptionCatcher : NSObject

+ (BOOL)performRequestAuthorizationWithHealthStore:(HKHealthStore *)healthStore
                                          toShare:(NSSet<HKSampleType *> *)shareTypes
                                             read:(NSSet<HKObjectType *> *)readTypes
                                       completion:(void (^)(BOOL success, NSError * _Nullable error))completion
                                            error:(NSError * _Nullable * _Nullable)error;

@end

NS_ASSUME_NONNULL_END
