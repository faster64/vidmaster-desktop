import { describe, it, expect } from "vitest";
import { pickEncoderFromFfmpegOutput } from "../../electron/gpuDetect.js";

describe("pickEncoderFromFfmpegOutput", () => {
  it("picks h264_nvenc when present", () => {
    const sample = ` V..... h264_nvenc           NVIDIA NVENC H.264 encoder\n V..... libx264              libx264 H.264 / AVC`;
    expect(pickEncoderFromFfmpegOutput(sample)).toBe("h264_nvenc");
  });
  it("picks h264_qsv when nvenc absent but qsv present", () => {
    const sample = ` V..... h264_qsv             H.264 / AVC (Intel Quick Sync Video)\n V..... libx264              libx264`;
    expect(pickEncoderFromFfmpegOutput(sample)).toBe("h264_qsv");
  });
  it("picks h264_amf when only AMF available", () => {
    const sample = ` V..... h264_amf             AMD AMF\n V..... libx264              libx264`;
    expect(pickEncoderFromFfmpegOutput(sample)).toBe("h264_amf");
  });
  it("falls back to libx264 when no GPU encoder is reported", () => {
    expect(pickEncoderFromFfmpegOutput(` V..... libx264              libx264`)).toBe("libx264");
  });
});
