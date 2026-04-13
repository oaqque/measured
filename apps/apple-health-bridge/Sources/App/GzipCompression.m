#import "GzipCompression.h"

#include <zlib.h>

@implementation GzipCompression

+ (nullable NSData *)gzipData:(NSData *)data error:(NSError * _Nullable * _Nullable)error {
    if (data.length == 0) {
        return [NSData data];
    }

    z_stream stream;
    memset(&stream, 0, sizeof(stream));

    int initResult = deflateInit2(&stream, Z_DEFAULT_COMPRESSION, Z_DEFLATED, 15 + 16, 8, Z_DEFAULT_STRATEGY);
    if (initResult != Z_OK) {
        if (error) {
            *error = [NSError errorWithDomain:@"GzipCompression" code:initResult userInfo:@{
                NSLocalizedDescriptionKey: @"Failed to initialize gzip stream.",
            }];
        }
        return nil;
    }

    NSMutableData *output = [NSMutableData dataWithLength:MAX((NSUInteger)16384, data.length / 2)];
    stream.next_in = (Bytef *)data.bytes;
    stream.avail_in = (uInt)data.length;

    int status = Z_OK;
    while (status == Z_OK) {
        if (stream.total_out >= output.length) {
            [output increaseLengthBy:MAX((NSUInteger)16384, data.length / 4)];
        }

        stream.next_out = (Bytef *)output.mutableBytes + stream.total_out;
        stream.avail_out = (uInt)(output.length - stream.total_out);
        status = deflate(&stream, stream.avail_in == 0 ? Z_FINISH : Z_NO_FLUSH);
    }

    deflateEnd(&stream);

    if (status != Z_STREAM_END) {
        if (error) {
            *error = [NSError errorWithDomain:@"GzipCompression" code:status userInfo:@{
                NSLocalizedDescriptionKey: @"Failed to gzip payload.",
            }];
        }
        return nil;
    }

    [output setLength:stream.total_out];
    return output;
}

@end
