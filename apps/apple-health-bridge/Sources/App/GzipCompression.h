#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface GzipCompression : NSObject

+ (nullable NSData *)gzipData:(NSData *)data error:(NSError * _Nullable * _Nullable)error;

@end

NS_ASSUME_NONNULL_END
