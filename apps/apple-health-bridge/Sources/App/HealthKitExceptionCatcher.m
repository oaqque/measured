#import "HealthKitExceptionCatcher.h"

static NSString * const HealthKitExceptionCatcherErrorDomain = @"HealthKitExceptionCatcher";

@implementation HealthKitExceptionCatcher

+ (BOOL)performRequestAuthorizationWithHealthStore:(HKHealthStore *)healthStore
                                          toShare:(NSSet<HKSampleType *> *)shareTypes
                                             read:(NSSet<HKObjectType *> *)readTypes
                                       completion:(void (^)(BOOL success, NSError * _Nullable error))completion
                                            error:(NSError * _Nullable * _Nullable)error {
    @try {
        [healthStore requestAuthorizationToShareTypes:shareTypes
                                            readTypes:readTypes
                                           completion:^(BOOL success, NSError * _Nullable requestError) {
            completion(success, requestError);
        }];
        return YES;
    } @catch (NSException *exception) {
        if (error != NULL) {
            *error = [NSError errorWithDomain:HealthKitExceptionCatcherErrorDomain
                                         code:1
                                     userInfo:@{
                NSLocalizedDescriptionKey: exception.reason ?: @"HealthKit rejected the authorization request.",
                @"exceptionName": exception.name,
            }];
        }
        return NO;
    }
}

+ (BOOL)getRequestStatusWithHealthStore:(HKHealthStore *)healthStore
                                toShare:(NSSet<HKSampleType *> *)shareTypes
                                   read:(NSSet<HKObjectType *> *)readTypes
                             completion:(void (^)(HKAuthorizationRequestStatus status, NSError * _Nullable error))completion
                                  error:(NSError * _Nullable * _Nullable)error {
    @try {
        [healthStore getRequestStatusForAuthorizationToShareTypes:shareTypes
                                                        readTypes:readTypes
                                                       completion:^(HKAuthorizationRequestStatus status, NSError * _Nullable requestError) {
            completion(status, requestError);
        }];
        return YES;
    } @catch (NSException *exception) {
        if (error != NULL) {
            *error = [NSError errorWithDomain:HealthKitExceptionCatcherErrorDomain
                                         code:2
                                     userInfo:@{
                NSLocalizedDescriptionKey: exception.reason ?: @"HealthKit rejected the authorization status request.",
                @"exceptionName": exception.name,
            }];
        }
        return NO;
    }
}

@end
