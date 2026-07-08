(() => {
  // core.js
  var FRAME_PREFIX_LENGTH = 8;
  var FRAME_LENGTH_LENGTH = 2;
  var FRAME_HEADER_LENGTH = FRAME_PREFIX_LENGTH + FRAME_LENGTH_LENGTH;
  var FRAME_SCAN_OFFSETS = [0, 2, 4, 6, 8, 10, 12, 14, 16];
  var MAX_FRAME_SCAN_OFFSET = 96;
  var MAX_RAW_PROTOBUF_SCAN_OFFSET = 256;
  var MAC_RE = /^[0-9a-fA-F]{1,2}(:[0-9a-fA-F]{1,2}){5}$/;
  async function gzip(bytes) {
    const cs = new CompressionStream("gzip");
    return concatBytes(
      await Array.fromAsync(ReadableStream.from([bytes]).pipeThrough(cs))
    );
  }
  async function ungzip(bytes) {
    const ds = new DecompressionStream("gzip");
    return concatBytes(
      await Array.fromAsync(ReadableStream.from([bytes]).pipeThrough(ds))
    );
  }
  async function patchWithStats(input, target) {
    const isCompressed = isGzip(input);
    const bytes = isCompressed ? await ungzip(input) : input;
    const stats = newStats();
    const patched = patchWlocBody(bytes, normalizeTarget(target), stats);
    return {
      body: isCompressed ? await gzip(patched) : patched,
      stats
    };
  }
  function patchWlocBody(bytes, target, stats) {
    const errors = [];
    for (const offset of candidateFrameOffsets(bytes)) {
      const snapshot = cloneStats(stats);
      try {
        return patchFrame(bytes, offset, target, stats);
      } catch (error) {
        restoreStats(stats, snapshot);
        if (errors.length < 6) errors.push(`@${offset}:${error.message}`);
      }
    }
    for (let offset = 0; offset <= Math.min(MAX_RAW_PROTOBUF_SCAN_OFFSET, bytes.length); offset++) {
      const snapshot = cloneStats(stats);
      try {
        const patchedPayload = patchAppleWLoc(bytes.slice(offset), target, stats);
        if (stats.locations > snapshot.locations) {
          return concatBytes([bytes.slice(0, offset), patchedPayload]);
        }
      } catch (error) {
        if (errors.length < 6) errors.push(`raw@${offset}:${error.message}`);
      }
      restoreStats(stats, snapshot);
    }
    throw new Error(`no patchable wloc payload found; ${errors.join(" | ")}`);
  }
  function patchFrame(bytes, offset, target, stats) {
    const snapshot = cloneStats(stats);
    const payload = readFramePayload(bytes, offset);
    const payloadStart = offset + FRAME_HEADER_LENGTH;
    const payloadEnd = payloadStart + payload.length;
    const patchedPayload = patchAppleWLoc(payload, target, stats);
    if (stats.locations <= snapshot.locations) {
      throw new Error("frame parsed but no location fields were patched");
    }
    if (patchedPayload.length > 65535) {
      throw new Error(`patched payload too large: ${patchedPayload.length}`);
    }
    return concatBytes([
      bytes.slice(0, offset + FRAME_PREFIX_LENGTH),
      Uint8Array.of(
        patchedPayload.length >> 8 & 255,
        patchedPayload.length & 255
      ),
      patchedPayload,
      bytes.slice(payloadEnd)
    ]);
  }
  function readFramePayload(bytes, offset) {
    if (bytes.length < offset + FRAME_HEADER_LENGTH) {
      throw new Error(`body too short: ${bytes.length}, offset=${offset}`);
    }
    const length = bytes[offset + FRAME_PREFIX_LENGTH] << 8 | bytes[offset + FRAME_PREFIX_LENGTH + 1];
    if (length <= 0) throw new Error(`invalid empty frame length at ${offset}`);
    const payloadStart = offset + FRAME_HEADER_LENGTH;
    const payloadEnd = payloadStart + length;
    if (payloadEnd > bytes.length) {
      throw new Error(
        `invalid frame length ${length} at ${offset} for body length ${bytes.length}`
      );
    }
    return bytes.slice(payloadStart, payloadEnd);
  }
  function patchAppleWLoc(bytes, target, stats) {
    const fields = parseFields(bytes);
    const chunks = [];
    for (const field of fields) {
      if (field.fieldNo === 2 && field.wireType === 2) {
        chunks.push(
          encodeField(
            field.fieldNo,
            field.wireType,
            patchWifiDevice(field.value, target, stats)
          )
        );
      } else if ((field.fieldNo === 22 || field.fieldNo === 24) && field.wireType === 2) {
        chunks.push(
          encodeField(
            field.fieldNo,
            field.wireType,
            patchCellTower(field.value, target, stats)
          )
        );
      } else {
        chunks.push(field.raw);
      }
    }
    return concatBytes(chunks);
  }
  function patchWifiDevice(bytes, target, stats) {
    const fields = parseFields(bytes);
    const hasBssid = fields.some(
      (field) => field.fieldNo === 1 && field.wireType === 2 && MAC_RE.test(ascii(field.value))
    );
    if (!hasBssid) return bytes;
    let changed = false;
    const chunks = [];
    for (const field of fields) {
      if (field.fieldNo === 2 && field.wireType === 2) {
        const patchedLocation = patchLocation(field.value, target, stats);
        changed ||= !bytesEqual(patchedLocation, field.value);
        chunks.push(encodeField(field.fieldNo, field.wireType, patchedLocation));
      } else {
        chunks.push(field.raw);
      }
    }
    if (changed) stats.wifi++;
    return changed ? concatBytes(chunks) : bytes;
  }
  function patchCellTower(bytes, target, stats) {
    const fields = parseFields(bytes);
    let changed = false;
    const chunks = [];
    for (const field of fields) {
      if (field.fieldNo === 5 && field.wireType === 2) {
        const patchedLocation = patchLocation(field.value, target, stats);
        changed ||= !bytesEqual(patchedLocation, field.value);
        chunks.push(encodeField(field.fieldNo, field.wireType, patchedLocation));
      } else {
        chunks.push(field.raw);
      }
    }
    if (changed) stats.cell++;
    return changed ? concatBytes(chunks) : bytes;
  }
  function patchLocation(bytes, target, stats) {
    const fields = parseFields(bytes);
    const hasLatitude = fields.some(
      (field) => field.fieldNo === 1 && field.wireType === 0
    );
    const hasLongitude = fields.some(
      (field) => field.fieldNo === 2 && field.wireType === 0
    );
    if (!hasLatitude || !hasLongitude) return bytes;
    const latitude = Math.round(target.latitude * 1e8);
    const longitude = Math.round(target.longitude * 1e8);
    const altitude = target.altitude == null ? null : Math.round(target.altitude * 1e4);
    let sawAltitude = false;
    let changed = false;
    const chunks = [];
    for (const field of fields) {
      let next = field.raw;
      if (field.fieldNo === 1 && field.wireType === 0) {
        next = encodeField(1, 0, latitude);
      } else if (field.fieldNo === 2 && field.wireType === 0) {
        next = encodeField(2, 0, longitude);
      } else if (field.fieldNo === 3 && field.wireType === 0) {
        next = encodeField(3, 0, target.accuracy);
      } else if (field.fieldNo === 5 && field.wireType === 0 && altitude != null) {
        next = encodeField(5, 0, altitude);
        sawAltitude = true;
      }
      changed ||= !bytesEqual(next, field.raw);
      chunks.push(next);
    }
    if (altitude != null && !sawAltitude) {
      chunks.push(encodeField(5, 0, altitude));
      changed = true;
    }
    stats.locations++;
    if (changed) stats.changedLocations++;
    return changed ? concatBytes(chunks) : bytes;
  }
  function parseFields(bytes) {
    const fields = [];
    let offset = 0;
    while (offset < bytes.length) {
      const start = offset;
      const [tag, valueOffset] = readVarint(bytes, offset);
      offset = valueOffset;
      const tagNumber = Number(tag);
      const fieldNo = Math.floor(tagNumber / 8);
      const wireType = tagNumber & 7;
      if (fieldNo === 0) throw new Error(`invalid protobuf field 0 at ${start}`);
      let value;
      if (wireType === 0) {
        ;
        [value, offset] = readVarint(bytes, offset);
      } else if (wireType === 1) {
        value = take(bytes, offset, 8);
        offset += 8;
      } else if (wireType === 2) {
        const [length, dataOffset] = readVarint(bytes, offset);
        const size = toSafeLength(length);
        offset = dataOffset;
        value = take(bytes, offset, size);
        offset += size;
      } else if (wireType === 5) {
        value = take(bytes, offset, 4);
        offset += 4;
      } else {
        throw new Error(`unsupported wire type ${wireType} at ${start}`);
      }
      fields.push({
        fieldNo,
        wireType,
        value,
        raw: bytes.slice(start, offset)
      });
    }
    return fields;
  }
  function encodeField(fieldNo, wireType, value) {
    const key = encodeVarint(BigInt(fieldNo * 8 + wireType));
    if (wireType === 0) {
      return concatBytes([key, encodeInt64Varint(value)]);
    }
    if (wireType === 1 || wireType === 5) {
      return concatBytes([key, toBytes(value)]);
    }
    if (wireType === 2) {
      const bytes = toBytes(value);
      return concatBytes([key, encodeVarint(BigInt(bytes.length)), bytes]);
    }
    throw new Error(`cannot encode wire type ${wireType}`);
  }
  function readVarint(bytes, offset) {
    let value = 0n;
    let shift = 0n;
    for (let cursor = offset; cursor < bytes.length; cursor++) {
      const byte = bytes[cursor];
      value |= BigInt(byte & 127) << shift;
      if ((byte & 128) === 0) return [value, cursor + 1];
      shift += 7n;
      if (shift >= 70n) throw new Error(`varint too long at ${offset}`);
    }
    throw new Error(`truncated varint at ${offset}`);
  }
  function encodeInt64Varint(value) {
    const bigint = BigInt(Math.trunc(Number(value)));
    return encodeVarint(bigint < 0n ? BigInt.asUintN(64, bigint) : bigint);
  }
  function encodeVarint(value) {
    let bigint = BigInt(value);
    const bytes = [];
    while (bigint > 0x7fn) {
      bytes.push(Number(bigint & 0x7fn | 0x80n));
      bigint >>= 7n;
    }
    bytes.push(Number(bigint));
    return Uint8Array.from(bytes);
  }
  function candidateFrameOffsets(bytes) {
    const offsets = [...FRAME_SCAN_OFFSETS];
    const max = Math.min(
      MAX_FRAME_SCAN_OFFSET,
      Math.max(0, bytes.length - FRAME_HEADER_LENGTH)
    );
    for (let offset = 0; offset <= max; offset++) {
      if (!offsets.includes(offset)) offsets.push(offset);
    }
    return offsets;
  }
  function normalizeTarget(target) {
    const longitude = Number(target?.longitude);
    const latitude = Number(target?.latitude);
    const accuracy = target?.accuracy == null ? 25 : Number(target.accuracy);
    const altitude = target?.altitude == null ? null : Number(target.altitude);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      throw new Error(
        "target.longitude and target.latitude must be finite numbers"
      );
    }
    if (longitude < -180 || longitude > 180) {
      throw new Error(
        `target.longitude must be between -180 and 180, got ${longitude}`
      );
    }
    if (latitude < -90 || latitude > 90) {
      throw new Error(
        `target.latitude must be between -90 and 90, got ${latitude}; longitude/latitude may be swapped`
      );
    }
    if (!Number.isFinite(accuracy)) {
      throw new Error("target.accuracy must be a finite number");
    }
    if (altitude != null && !Number.isFinite(altitude)) {
      throw new Error("target.altitude must be a finite number when provided");
    }
    return { longitude, latitude, accuracy: Math.round(accuracy), altitude };
  }
  function newStats() {
    return { wifi: 0, cell: 0, locations: 0, changedLocations: 0 };
  }
  function cloneStats(stats) {
    return { ...stats };
  }
  function restoreStats(stats, snapshot) {
    stats.wifi = snapshot.wifi;
    stats.cell = snapshot.cell;
    stats.locations = snapshot.locations;
    stats.changedLocations = snapshot.changedLocations;
  }
  function toBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    if (Array.isArray(value)) return Uint8Array.from(value);
    throw new TypeError(
      "expected Uint8Array, ArrayBuffer, typed array, or number[]"
    );
  }
  function take(bytes, offset, length) {
    if (offset + length > bytes.length) {
      throw new Error(
        `truncated field at ${offset}; need ${length} bytes, have ${bytes.length - offset}`
      );
    }
    return bytes.slice(offset, offset + length);
  }
  function toSafeLength(value) {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`length exceeds safe integer range: ${value}`);
    }
    return Number(value);
  }
  function concatBytes(chunks) {
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
  function bytesEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  function ascii(bytes) {
    return String.fromCharCode(...bytes);
  }
  function isGzip(bytes) {
    return bytes.length >= 2 && bytes[0] === 31 && bytes[1] === 139;
  }
  function randomPoint(lat, lng, radius) {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.sqrt(Math.random()) * radius;
    const dx = distance * Math.cos(angle);
    const dy = distance * Math.sin(angle);
    return [
      lat + dy / 111320,
      lng + dx / (111320 * Math.cos(lat * Math.PI / 180))
    ];
  }

  // response-common.js
  async function response() {
    const [lat, lng] = randomPoint(30.30329, 120.10133, 5);
    const altitude = 8 + Math.random();
    const { body, stats } = await patchWithStats(
      new Uint8Array($response.bodyBytes),
      {
        latitude: lat,
        longitude: lng,
        altitude,
        accuracy: 19 + Math.random() * 5
      }
    );
    console.log(`stats: ${JSON.stringify(stats)}`);
    $done({
      bodyBytes: body.buffer
    });
  }

  // response.js
  response();
})();
