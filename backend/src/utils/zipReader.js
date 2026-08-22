import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import {
  createInflateRaw,
  inflateRawSync
} from "node:zlib";

const EOCD_SIGNATURE =
  0x06054b50;

const CENTRAL_SIGNATURE =
  0x02014b50;

const LOCAL_SIGNATURE =
  0x04034b50;

const MAX_EOCD_SEARCH =
  65_557;

function findEndOfCentralDirectory(
  buffer
) {
  if (
    buffer.length < 22
  ) {
    throw new Error(
      "ZIP file is too small."
    );
  }

  const start =
    Math.max(
      0,
      buffer.length -
        MAX_EOCD_SEARCH
    );

  for (
    let offset =
      buffer.length - 22;
    offset >= start;
    offset -= 1
  ) {
    if (
      buffer.readUInt32LE(
        offset
      ) !==
      EOCD_SIGNATURE
    ) {
      continue;
    }

    const commentLength =
      buffer.readUInt16LE(
        offset + 20
      );

    if (
      offset +
        22 +
        commentLength ===
      buffer.length
    ) {
      return offset;
    }
  }

  throw new Error(
    "ZIP end-of-central-directory record was not found."
  );
}

function safeEntryName(name) {
  const normalized =
    String(
      name || ""
    )
      .replace(
        /\\/g,
        "/"
      )
      .replace(
        /^\/+/,
        ""
      );

  if (
    !normalized ||
    normalized
      .split("/")
      .includes("..") ||
    path.isAbsolute(
      normalized
    )
  ) {
    throw new Error(
      "ZIP contains an unsafe entry path."
    );
  }

  return normalized;
}

function parseEndOfCentralDirectory(
  buffer,
  eocd
) {
  const diskNumber =
    buffer.readUInt16LE(
      eocd + 4
    );

  const centralDisk =
    buffer.readUInt16LE(
      eocd + 6
    );

  const diskEntryCount =
    buffer.readUInt16LE(
      eocd + 8
    );

  const entryCount =
    buffer.readUInt16LE(
      eocd + 10
    );

  const centralSize =
    buffer.readUInt32LE(
      eocd + 12
    );

  const centralOffset =
    buffer.readUInt32LE(
      eocd + 16
    );

  if (
    diskNumber !== 0 ||
    centralDisk !== 0 ||
    diskEntryCount !==
      entryCount ||
    entryCount === 0xffff ||
    centralOffset ===
      0xffffffff ||
    centralSize ===
      0xffffffff
  ) {
    throw new Error(
      "Multi-disk and ZIP64 archives are not supported."
    );
  }

  return {
    entryCount,
    centralSize,
    centralOffset
  };
}

function parseCentralDirectory(
  buffer,
  expectedEntryCount
) {
  const entries = [];

  let offset = 0;

  for (
    let index = 0;
    index <
    expectedEntryCount;
    index += 1
  ) {
    if (
      offset + 46 >
        buffer.length ||
      buffer.readUInt32LE(
        offset
      ) !==
        CENTRAL_SIGNATURE
    ) {
      throw new Error(
        "ZIP central directory entry is invalid."
      );
    }

    const flags =
      buffer.readUInt16LE(
        offset + 8
      );

    const method =
      buffer.readUInt16LE(
        offset + 10
      );

    const compressedSize =
      buffer.readUInt32LE(
        offset + 20
      );

    const uncompressedSize =
      buffer.readUInt32LE(
        offset + 24
      );

    const nameLength =
      buffer.readUInt16LE(
        offset + 28
      );

    const extraLength =
      buffer.readUInt16LE(
        offset + 30
      );

    const commentLength =
      buffer.readUInt16LE(
        offset + 32
      );

    const localOffset =
      buffer.readUInt32LE(
        offset + 42
      );

    const nextOffset =
      offset +
      46 +
      nameLength +
      extraLength +
      commentLength;

    if (
      nextOffset >
      buffer.length
    ) {
      throw new Error(
        "ZIP central directory entry exceeds its declared bounds."
      );
    }

    if (
      localOffset ===
        0xffffffff ||
      compressedSize ===
        0xffffffff ||
      uncompressedSize ===
        0xffffffff
    ) {
      throw new Error(
        "ZIP64 entries are not supported."
      );
    }

    const rawName =
      buffer
        .subarray(
          offset + 46,
          offset +
            46 +
            nameLength
        )
        .toString(
          flags & 0x800
            ? "utf8"
            : "latin1"
        );

    const entryName =
      safeEntryName(
        rawName
      );

    entries.push({
      entryName,

      isDirectory:
        entryName.endsWith(
          "/"
        ),

      flags,
      method,
      compressedSize,
      uncompressedSize,
      localOffset
    });

    offset =
      nextOffset;
  }

  if (
    offset !==
    buffer.length
  ) {
    throw new Error(
      "ZIP central directory size does not match its entries."
    );
  }

  return entries;
}

async function readZipDirectoryFromDisk(
  filePath
) {
  const handle =
    await fsp.open(
      filePath,
      "r"
    );

  try {
    const stat =
      await handle.stat();

    if (
      stat.size < 22
    ) {
      throw new Error(
        "ZIP file is too small."
      );
    }

    const tailLength =
      Math.min(
        stat.size,
        MAX_EOCD_SEARCH
      );

    const tail =
      Buffer.alloc(
        tailLength
      );

    await handle.read(
      tail,
      0,
      tailLength,
      stat.size -
        tailLength
    );

    const eocdInTail =
      findEndOfCentralDirectory(
        tail
      );

    const {
      entryCount,
      centralSize,
      centralOffset
    } =
      parseEndOfCentralDirectory(
        tail,
        eocdInTail
      );

    if (
      centralOffset +
        centralSize >
      stat.size
    ) {
      throw new Error(
        "ZIP central directory is outside the archive bounds."
      );
    }

    if (
      centralSize >
      64 *
        1024 *
        1024
    ) {
      throw new Error(
        "ZIP central directory is unexpectedly large."
      );
    }

    const central =
      Buffer.alloc(
        centralSize
      );

    await handle.read(
      central,
      0,
      centralSize,
      centralOffset
    );

    return {
      size: stat.size,

      entries:
        parseCentralDirectory(
          central,
          entryCount
        )
    };
  } finally {
    await handle.close();
  }
}

async function localDataOffset(
  filePath,
  entry
) {
  const handle =
    await fsp.open(
      filePath,
      "r"
    );

  try {
    const localHeader =
      Buffer.alloc(30);

    const {
      bytesRead
    } =
      await handle.read(
        localHeader,
        0,
        30,
        entry.localOffset
      );

    if (
      bytesRead !== 30 ||
      localHeader.readUInt32LE(
        0
      ) !==
        LOCAL_SIGNATURE
    ) {
      throw new Error(
        `Invalid local ZIP header: ${entry.entryName}`
      );
    }

    const localFlags =
      localHeader.readUInt16LE(
        6
      );

    const localMethod =
      localHeader.readUInt16LE(
        8
      );

    const localNameLength =
      localHeader.readUInt16LE(
        26
      );

    const localExtraLength =
      localHeader.readUInt16LE(
        28
      );

    if (
      localFlags !==
        entry.flags ||
      localMethod !==
        entry.method
    ) {
      throw new Error(
        `ZIP local/central header mismatch: ${entry.entryName}`
      );
    }

    return (
      entry.localOffset +
      30 +
      localNameLength +
      localExtraLength
    );
  } finally {
    await handle.close();
  }
}

export async function openZipEntryStream(
  filePath,
  {
    predicate,

    maxUncompressedBytes =
      Number.POSITIVE_INFINITY
  } = {}
) {
  const directory =
    await readZipDirectoryFromDisk(
      filePath
    );

  const entry =
    directory.entries.find(
      (candidate) =>
        predicate
          ? predicate(
              candidate
            )
          : !candidate.isDirectory
    );

  if (!entry) {
    throw new Error(
      "ZIP does not contain a matching file entry."
    );
  }

  if (
    entry.isDirectory
  ) {
    throw new Error(
      `ZIP entry is a directory: ${entry.entryName}`
    );
  }

  if (
    entry.flags & 1
  ) {
    throw new Error(
      `Encrypted ZIP entry is not supported: ${entry.entryName}`
    );
  }

  if (
    ![0, 8].includes(
      entry.method
    )
  ) {
    throw new Error(
      `Unsupported ZIP compression method ${entry.method}: ${entry.entryName}`
    );
  }

  const maxBytes =
    Number(
      maxUncompressedBytes
    );

  if (
    !Number.isFinite(
      maxBytes
    ) ||
    maxBytes < 0 ||
    entry.uncompressedSize >
      maxBytes
  ) {
    throw new Error(
      `ZIP entry exceeds the configured output limit: ${entry.entryName}`
    );
  }

  const dataOffset =
    await localDataOffset(
      filePath,
      entry
    );

  const dataEnd =
    dataOffset +
    entry.compressedSize -
    1;

  if (
    entry.compressedSize <=
      0 ||
    dataEnd >=
      directory.size
  ) {
    throw new Error(
      `ZIP entry data exceeds archive bounds: ${entry.entryName}`
    );
  }

  const compressed =
    fs.createReadStream(
      filePath,
      {
        start:
          dataOffset,

        end:
          dataEnd
      }
    );

  let produced = 0;

  const output =
    new Transform({
      transform(
        chunk,
        _encoding,
        callback
      ) {
        produced +=
          chunk.length;

        if (
          produced >
            maxBytes ||
          produced >
            entry.uncompressedSize
        ) {
          callback(
            new Error(
              `ZIP entry exceeded its declared/configured output size: ${entry.entryName}`
            )
          );

          return;
        }

        callback(
          null,
          chunk
        );
      },

      flush(callback) {
        if (
          produced !==
          entry.uncompressedSize
        ) {
          callback(
            new Error(
              `ZIP entry size mismatch: ${entry.entryName}`
            )
          );

          return;
        }

        callback();
      }
    });

  compressed.on(
    "error",
    (error) =>
      output.destroy(
        error
      )
  );

  if (
    entry.method === 0
  ) {
    compressed.pipe(
      output
    );
  } else {
    const inflater =
      createInflateRaw();

    inflater.on(
      "error",
      (error) =>
        output.destroy(
          error
        )
    );

    compressed
      .pipe(inflater)
      .pipe(output);
  }

  return {
    entryName:
      entry.entryName,

    isDirectory:
      entry.isDirectory,

    header: {
      size:
        entry.uncompressedSize,

      compressedSize:
        entry.compressedSize,

      flags:
        entry.flags,

      method:
        entry.method
    },

    stream:
      output
  };
}

export async function readZipFile(
  filePath
) {
  const buffer =
    await fsp.readFile(
      filePath
    );

  const eocd =
    findEndOfCentralDirectory(
      buffer
    );

  const {
    entryCount,
    centralSize,
    centralOffset
  } =
    parseEndOfCentralDirectory(
      buffer,
      eocd
    );

  const centralEnd =
    centralOffset +
    centralSize;

  if (
    centralEnd > eocd ||
    centralEnd >
      buffer.length
  ) {
    throw new Error(
      "ZIP central directory is invalid."
    );
  }

  const directoryEntries =
    parseCentralDirectory(
      buffer.subarray(
        centralOffset,
        centralEnd
      ),
      entryCount
    );

  const entries =
    directoryEntries.map(
      (entry) => {
        const getData = (
          maxOutputBytes =
            entry.uncompressedSize
        ) => {
          if (
            entry.flags &
            1
          ) {
            throw new Error(
              `Encrypted ZIP entry is not supported: ${entry.entryName}`
            );
          }

          if (
            entry.localOffset +
              30 >
              centralOffset ||
            buffer.readUInt32LE(
              entry.localOffset
            ) !==
              LOCAL_SIGNATURE
          ) {
            throw new Error(
              `Invalid local ZIP header: ${entry.entryName}`
            );
          }

          const localFlags =
            buffer.readUInt16LE(
              entry.localOffset +
                6
            );

          const localMethod =
            buffer.readUInt16LE(
              entry.localOffset +
                8
            );

          const localNameLength =
            buffer.readUInt16LE(
              entry.localOffset +
                26
            );

          const localExtraLength =
            buffer.readUInt16LE(
              entry.localOffset +
                28
            );

          const dataOffset =
            entry.localOffset +
            30 +
            localNameLength +
            localExtraLength;

          if (
            localFlags !==
              entry.flags ||
            localMethod !==
              entry.method
          ) {
            throw new Error(
              `ZIP local/central header mismatch: ${entry.entryName}`
            );
          }

          if (
            dataOffset >
              centralOffset ||
            dataOffset +
              entry.compressedSize >
              centralOffset ||
            dataOffset +
              entry.compressedSize >
              buffer.length
          ) {
            throw new Error(
              `ZIP entry data exceeds archive bounds: ${entry.entryName}`
            );
          }

          const limit =
            Number(
              maxOutputBytes
            );

          if (
            !Number.isFinite(
              limit
            ) ||
            limit < 0 ||
            entry.uncompressedSize >
              limit
          ) {
            throw new Error(
              `ZIP entry exceeds the configured output limit: ${entry.entryName}`
            );
          }

          const compressed =
            buffer.subarray(
              dataOffset,
              dataOffset +
                entry.compressedSize
            );

          let data;

          if (
            entry.method === 0
          ) {
            data =
              Buffer.from(
                compressed
              );
          } else if (
            entry.method === 8
          ) {
            data =
              inflateRawSync(
                compressed,
                {
                  maxOutputLength:
                    Math.max(
                      1,
                      Math.floor(
                        limit
                      ) + 1
                    )
                }
              );
          } else {
            throw new Error(
              `Unsupported ZIP compression method ${entry.method}: ${entry.entryName}`
            );
          }

          if (
            data.length !==
            entry.uncompressedSize
          ) {
            throw new Error(
              `ZIP entry size mismatch: ${entry.entryName}`
            );
          }

          return data;
        };

        return {
          entryName:
            entry.entryName,

          isDirectory:
            entry.isDirectory,

          header: {
            size:
              entry.uncompressedSize,

            compressedSize:
              entry.compressedSize,

            flags:
              entry.flags,

            method:
              entry.method
          },

          getData
        };
      }
    );

  return entries;
}