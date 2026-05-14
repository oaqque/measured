#import "GzipCompression.h"

#include <zlib.h>

#define GZIP_FILE_BUFFER_SIZE (64 * 1024)

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

+ (BOOL)gzipFileAtURL:(NSURL *)sourceURL toURL:(NSURL *)destinationURL error:(NSError * _Nullable * _Nullable)error {
    NSInputStream *inputStream = [NSInputStream inputStreamWithURL:sourceURL];
    NSOutputStream *outputStream = [NSOutputStream outputStreamWithURL:destinationURL append:NO];
    [inputStream open];
    [outputStream open];

    if (inputStream.streamStatus == NSStreamStatusError || outputStream.streamStatus == NSStreamStatusError) {
        if (error) {
            *error = inputStream.streamError ?: outputStream.streamError ?: [NSError errorWithDomain:@"GzipCompression" code:-1 userInfo:@{
                NSLocalizedDescriptionKey: @"Failed to open gzip streams.",
            }];
        }
        [inputStream close];
        [outputStream close];
        return NO;
    }

    z_stream stream;
    memset(&stream, 0, sizeof(stream));

    int initResult = deflateInit2(&stream, Z_DEFAULT_COMPRESSION, Z_DEFLATED, 15 + 16, 8, Z_DEFAULT_STRATEGY);
    if (initResult != Z_OK) {
        if (error) {
            *error = [NSError errorWithDomain:@"GzipCompression" code:initResult userInfo:@{
                NSLocalizedDescriptionKey: @"Failed to initialize gzip file stream.",
            }];
        }
        [inputStream close];
        [outputStream close];
        return NO;
    }

    uint8_t inputBuffer[GZIP_FILE_BUFFER_SIZE];
    uint8_t outputBuffer[GZIP_FILE_BUFFER_SIZE];
    BOOL succeeded = YES;
    BOOL reachedEnd = NO;

    while (!reachedEnd && succeeded) {
        NSInteger bytesRead = [inputStream read:inputBuffer maxLength:GZIP_FILE_BUFFER_SIZE];
        if (bytesRead < 0) {
            if (error) {
                *error = inputStream.streamError ?: [NSError errorWithDomain:@"GzipCompression" code:-2 userInfo:@{
                    NSLocalizedDescriptionKey: @"Failed to read gzip input file.",
                }];
            }
            succeeded = NO;
            break;
        }

        reachedEnd = bytesRead == 0;
        stream.next_in = inputBuffer;
        stream.avail_in = (uInt)bytesRead;

        int flush = reachedEnd ? Z_FINISH : Z_NO_FLUSH;
        int status = Z_OK;

        do {
            stream.next_out = outputBuffer;
            stream.avail_out = GZIP_FILE_BUFFER_SIZE;
            status = deflate(&stream, flush);

            if (status == Z_STREAM_ERROR) {
                if (error) {
                    *error = [NSError errorWithDomain:@"GzipCompression" code:status userInfo:@{
                        NSLocalizedDescriptionKey: @"Failed to gzip file payload.",
                    }];
                }
                succeeded = NO;
                break;
            }

            NSUInteger bytesToWrite = GZIP_FILE_BUFFER_SIZE - stream.avail_out;
            if (bytesToWrite > 0) {
                NSUInteger bytesWrittenTotal = 0;
                while (bytesWrittenTotal < bytesToWrite) {
                    NSInteger bytesWritten = [outputStream write:outputBuffer + bytesWrittenTotal maxLength:bytesToWrite - bytesWrittenTotal];
                    if (bytesWritten <= 0) {
                        if (error) {
                            *error = outputStream.streamError ?: [NSError errorWithDomain:@"GzipCompression" code:-3 userInfo:@{
                                NSLocalizedDescriptionKey: @"Failed to write gzip output file.",
                            }];
                        }
                        succeeded = NO;
                        break;
                    }
                    bytesWrittenTotal += (NSUInteger)bytesWritten;
                }
            }
        } while (succeeded && stream.avail_out == 0);

        if (reachedEnd && status != Z_STREAM_END) {
            if (error) {
                *error = [NSError errorWithDomain:@"GzipCompression" code:status userInfo:@{
                    NSLocalizedDescriptionKey: @"Failed to finish gzip file payload.",
                }];
            }
            succeeded = NO;
        }
    }

    deflateEnd(&stream);
    [inputStream close];
    [outputStream close];
    return succeeded;
}

+ (nullable NSData *)gunzipData:(NSData *)data error:(NSError * _Nullable * _Nullable)error {
    if (data.length == 0) {
        return [NSData data];
    }

    z_stream stream;
    memset(&stream, 0, sizeof(stream));

    int initResult = inflateInit2(&stream, 15 + 32);
    if (initResult != Z_OK) {
        if (error) {
            *error = [NSError errorWithDomain:@"GzipCompression" code:initResult userInfo:@{
                NSLocalizedDescriptionKey: @"Failed to initialize gunzip stream.",
            }];
        }
        return nil;
    }

    NSMutableData *output = [NSMutableData dataWithLength:MAX((NSUInteger)16384, data.length * 2)];
    stream.next_in = (Bytef *)data.bytes;
    stream.avail_in = (uInt)data.length;

    int status = Z_OK;
    while (status == Z_OK) {
        if (stream.total_out >= output.length) {
            [output increaseLengthBy:MAX((NSUInteger)16384, output.length / 2)];
        }

        stream.next_out = (Bytef *)output.mutableBytes + stream.total_out;
        stream.avail_out = (uInt)(output.length - stream.total_out);
        status = inflate(&stream, Z_NO_FLUSH);
    }

    inflateEnd(&stream);

    if (status != Z_STREAM_END) {
        if (error) {
            *error = [NSError errorWithDomain:@"GzipCompression" code:status userInfo:@{
                NSLocalizedDescriptionKey: @"Failed to gunzip payload.",
            }];
        }
        return nil;
    }

    [output setLength:stream.total_out];
    return output;
}

@end
