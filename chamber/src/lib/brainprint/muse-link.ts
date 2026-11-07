/**
 * Web Bluetooth session for a Muse headset.
 * Classic presets: p50 when optics exist (EEG, motion, pulse), else p21.
 * Athena (MS-03): characteristic 273e0013, preset p1035, commands dc001 then L1.
 */

import {
  ATHENA_DEFAULT_PRESET,
  CLASSIC_EEG,
  MUSE_ACCEL,
  MUSE_ATHENA,
  MUSE_ATHENA_AUX,
  MUSE_ATHENA_SECONDARY,
  MUSE_CONTROL,
  MUSE_EEG_UUID,
  MUSE_GYRO,
  MUSE_PPG_UUID,
  MUSE_SERVICE,
  MUSE_TELEMETRY,
  consumeControl,
  decodeAthenaNotification,
  decodeClassicImu,
  decodeClassicPpg,
  decodeMuseEeg,
  decodeTelemetry,
  encodeCommand,
  readBatteryPercent,
  readHorseshoe,
  ACC_SCALE,
  GYRO_SCALE,
  type Contact,
  type XYZ,
} from "./muse-protocol.ts";

export type MuseFamily = "classic" | "athena";

export type MuseIngest = {
  eeg: (channel: string, samples: number[]) => void;
  ppg: (channel: string, samples: number[]) => void;
  accel: (samples: XYZ[]) => void;
  gyro: (samples: XYZ[]) => void;
  telemetry: (battery: number, temperatureC: number | null, cellV: number | null) => void;
  info: (patch: { firmware?: string | null; hardware?: string | null; horseshoe?: Contact[] | null; battery?: number | null }) => void;
  gap: (channel: string) => void;
};

type Listener = { characteristic: BleChar; handler: () => void };

type BleChar = {
  startNotifications: () => Promise<unknown>;
  stopNotifications: () => Promise<unknown>;
  writeValue: (value: Uint8Array) => Promise<void>;
  writeValueWithoutResponse?: (value: Uint8Array) => Promise<void>;
  addEventListener: (type: string, cb: () => void) => void;
  removeEventListener: (type: string, cb: () => void) => void;
  value?: DataView | null;
};

type BleService = { getCharacteristic: (uuid: string) => Promise<BleChar> };

type BleDevice = {
  name?: string;
  gatt?: { connect: () => Promise<{ getPrimaryService: (uuid: string) => Promise<BleService> }> };
  addEventListener: (type: string, cb: () => void) => void;
  removeEventListener: (type: string, cb: () => void) => void;
};

function bluetoothApi(): { requestDevice: (opts: unknown) => Promise<BleDevice> } | null {
  if (typeof navigator === "undefined") return null;
  const nav = navigator as Navigator & { bluetooth?: { requestDevice: (opts: unknown) => Promise<BleDevice> } };
  return nav.bluetooth ?? null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MuseLink {
  private device: BleDevice | null = null;
  private control: BleChar | null = null;
  private listeners: Listener[] = [];
  private controlBuffer = "";
  private indexes = new Map<string, number>();
  private keepalive = 0;
  private readonly ingest: MuseIngest;
  private readonly onDisconnect: () => void;

  constructor(ingest: MuseIngest, onDisconnect: () => void) {
    this.ingest = ingest;
    this.onDisconnect = onDisconnect;
  }

  get bluetooth(): boolean {
    return bluetoothApi() !== null;
  }

  async connect(): Promise<{ name: string; family: MuseFamily; preset: string }> {
    const bluetooth = bluetoothApi();
    if (!bluetooth) throw new Error("This browser has no Bluetooth headset path.");
    let device: BleDevice;
    try {
      device = await bluetooth.requestDevice({
        filters: [{ services: [MUSE_SERVICE] }, { namePrefix: "Muse" }, { namePrefix: "MS-" }],
        optionalServices: [MUSE_SERVICE],
      });
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      if (name === "NotFoundError" || name === "NotAllowedError") throw new Error("The headset chooser was closed.");
      if (name === "SecurityError") {
        throw new Error("Bluetooth is blocked in this view. Chrome or Edge on a computer or Android can pair a Muse. The signal bench still runs here.");
      }
      throw new Error("The browser refused the Bluetooth request.");
    }
    const server = await device.gatt?.connect();
    if (!server) throw new Error("The headset did not open a connection.");
    let service: BleService;
    try {
      service = await server.getPrimaryService(MUSE_SERVICE);
    } catch {
      throw new Error("That device has no Muse EEG service.");
    }
    await this.release(true);
    this.device = device;
    device.addEventListener("gattserverdisconnected", this.onDisconnect);
    const control = await service.getCharacteristic(MUSE_CONTROL);
    this.control = control;
    await this.listen(control, (bytes) => this.onControl(bytes));
    const athena = await this.optional(service, MUSE_ATHENA);
    const classicEeg = await this.optional(service, MUSE_EEG_UUID.TP9);
    try {
      if (athena && !classicEeg) {
        await this.listen(athena, (bytes) => this.onAthena(bytes));
        await this.listenQuiet(service, MUSE_ATHENA_AUX);
        await this.listenQuiet(service, MUSE_ATHENA_SECONDARY);
        await this.athenaStart();
        return { name: device.name || "Muse S Athena", family: "athena", preset: ATHENA_DEFAULT_PRESET };
      }
      if (/athena|ms-03/i.test(device.name ?? "") && !classicEeg) {
        throw new Error("This Muse S Athena did not expose its sensor channel.");
      }
      const preset = await this.classicStart(service);
      return { name: device.name || "Muse", family: "classic", preset };
    } catch (error) {
      await this.release(true);
      throw error instanceof Error ? error : new Error("The headset refused the start command.");
    }
  }

  async disconnect(): Promise<void> {
    await this.release(false);
  }

  private async classicStart(service: BleService): Promise<string> {
    await this.write("h");
    for (const name of CLASSIC_EEG) {
      const characteristic = await service.getCharacteristic(MUSE_EEG_UUID[name]);
      await this.listen(characteristic, (bytes) => this.onClassicEeg(name, bytes));
    }
    const aux = await this.optional(service, MUSE_EEG_UUID.AUX);
    if (aux) await this.listen(aux, (bytes) => this.onClassicEeg("AUX", bytes));
    const accel = await this.optional(service, MUSE_ACCEL);
    if (accel) await this.listen(accel, (bytes) => this.onImu(bytes, ACC_SCALE, "accel"));
    const gyro = await this.optional(service, MUSE_GYRO);
    if (gyro) await this.listen(gyro, (bytes) => this.onImu(bytes, GYRO_SCALE, "gyro"));
    let ppg = false;
    for (const [name, uuid] of MUSE_PPG_UUID) {
      const characteristic = await this.optional(service, uuid);
      if (!characteristic) continue;
      ppg = true;
      await this.listen(characteristic, (bytes) => this.onPpg(name, bytes));
    }
    const telemetry = await this.optional(service, MUSE_TELEMETRY);
    if (telemetry) await this.listen(telemetry, (bytes) => this.onTelemetry(bytes));
    const preset = ppg ? "p50" : "p21";
    await this.write(preset);
    await this.write("s");
    await this.write("v1");
    this.armKeepalive();
    return preset;
  }

  private async athenaStart(): Promise<void> {
    const steps: [string, number][] = [
      ["v6", 200],
      ["s", 200],
      ["h", 200],
      [ATHENA_DEFAULT_PRESET, 200],
      ["s", 200],
      ["dc001", 50],
      ["dc001", 100],
      ["L1", 300],
      ["s", 200],
    ];
    for (const [step, wait] of steps) {
      await this.write(step);
      await delay(wait);
    }
    if (await this.waitForAthenaEeg(1000)) return;
    await this.write("d");
    await this.waitForAthenaEeg(1000);
  }

  private async waitForAthenaEeg(ms: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (this.indexes.has("athena:eeg")) return true;
      await delay(100);
    }
    return this.indexes.has("athena:eeg");
  }

  private onClassicEeg(channel: string, bytes: Uint8Array): void {
    const packet = decodeMuseEeg(bytes);
    if (!packet) return;
    this.noteIndex(channel, packet.index);
    this.ingest.eeg(channel, packet.samples);
  }

  private onPpg(channel: string, bytes: Uint8Array): void {
    const packet = decodeClassicPpg(bytes);
    if (!packet) return;
    this.noteIndex(`ppg:${channel}`, packet.index);
    this.ingest.ppg(channel, packet.samples);
  }

  private onImu(bytes: Uint8Array, scale: number, kind: "accel" | "gyro"): void {
    const packet = decodeClassicImu(bytes, scale);
    if (!packet) return;
    if (kind === "accel") this.ingest.accel(packet.samples);
    else this.ingest.gyro(packet.samples);
  }

  private onTelemetry(bytes: Uint8Array): void {
    const packet = decodeTelemetry(bytes);
    if (!packet) return;
    this.ingest.telemetry(packet.battery, packet.temperatureC, packet.cellV);
  }

  private onAthena(bytes: Uint8Array): void {
    for (const chunk of decodeAthenaNotification(bytes)) {
      if (chunk.type === "eeg") {
        this.noteIndex("athena:eeg", chunk.index, 8);
        chunk.channels.forEach((channel, index) => this.ingest.eeg(channel, chunk.samples[index] ?? []));
      } else if (chunk.type === "optics") {
        this.noteIndex("athena:optics", chunk.index, 8);
        chunk.channels.forEach((channel, index) => this.ingest.ppg(channel, chunk.samples[index] ?? []));
      } else if (chunk.type === "imu") {
        this.noteIndex("athena:imu", chunk.index, 8);
        this.ingest.accel(chunk.accel);
        this.ingest.gyro(chunk.gyro);
      } else if (chunk.type === "battery") {
        this.ingest.telemetry(chunk.percent, null, null);
      }
    }
  }

  private onControl(bytes: Uint8Array): void {
    const chunk = new TextDecoder().decode(bytes);
    const next = consumeControl(this.controlBuffer, chunk);
    this.controlBuffer = next.buffer;
    for (const message of next.messages) {
      const firmware = typeof message.fw === "string" ? message.fw : null;
      const hardware = typeof message.hw === "string" ? message.hw : null;
      this.ingest.info({
        firmware,
        hardware,
        horseshoe: readHorseshoe(message),
        battery: readBatteryPercent(message),
      });
    }
  }

  private noteIndex(channel: string, index: number, bits = 16): void {
    const mask = (1 << bits) - 1;
    const previous = this.indexes.get(channel);
    if (previous !== undefined && ((previous + 1) & mask) !== (index & mask)) this.ingest.gap(channel);
    this.indexes.set(channel, index & mask);
  }

  private async listenQuiet(service: BleService, uuid: string): Promise<void> {
    const characteristic = await this.optional(service, uuid);
    if (!characteristic) return;
    try {
      await this.listen(characteristic, (bytes) => this.onAthena(bytes));
    } catch {
      /* the auxiliary channel is often silent, and some phones refuse it */
    }
  }

  private async optional(service: BleService, uuid: string): Promise<BleChar | null> {
    try {
      return await service.getCharacteristic(uuid);
    } catch {
      return null;
    }
  }

  private async listen(characteristic: BleChar, onBytes: (bytes: Uint8Array) => void): Promise<void> {
    const handler = () => {
      const view = characteristic.value;
      if (!view) return;
      onBytes(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    };
    characteristic.addEventListener("characteristicvaluechanged", handler);
    await characteristic.startNotifications();
    this.listeners.push({ characteristic, handler });
  }

  private async write(command: string): Promise<void> {
    const control = this.control;
    if (!control) throw new Error("The headset has no control channel.");
    const encoded = encodeCommand(command);
    try {
      await control.writeValue(encoded);
    } catch {
      if (!control.writeValueWithoutResponse) throw new Error("The headset refused the start command.");
      await control.writeValueWithoutResponse(encoded);
    }
  }

  private armKeepalive(): void {
    if (this.keepalive) window.clearInterval(this.keepalive);
    this.keepalive = window.setInterval(() => {
      void this.write("k").catch(() => {});
    }, 10000);
  }

  private async release(quiet: boolean): Promise<void> {
    if (this.keepalive) window.clearInterval(this.keepalive);
    this.keepalive = 0;
    if (this.control && !quiet) {
      try {
        await this.write("h");
      } catch {
        /* already gone */
      }
    } else if (this.control) {
      try {
        await this.write("h");
      } catch {
        /* already gone */
      }
    }
    for (const listener of this.listeners) {
      listener.characteristic.removeEventListener("characteristicvaluechanged", listener.handler);
      void listener.characteristic.stopNotifications().catch(() => {});
    }
    this.listeners = [];
    if (this.device) this.device.removeEventListener("gattserverdisconnected", this.onDisconnect);
    this.device = null;
    this.control = null;
    this.controlBuffer = "";
    this.indexes.clear();
  }
}
