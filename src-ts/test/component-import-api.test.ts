import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { TestServer } from "./helpers/test-server";
import { cleanTestDatabase } from "./setup";

const PORT = 3003;
const server = new TestServer(PORT, "", {
  env: {
    OPENPCB_STARTUP_LICENSE_STATE: "active",
    OPENPCB_STARTUP_LICENSE_CODE: "TOKEN_VALID",
  },
});
const BASE_URL = `http://127.0.0.1:${PORT}/api/components/import`;
const FIXTURES_DIR = join(import.meta.dir, "../src/infrastructure/parsers/kicad/__fixtures__");

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf-8");
}

describe("Component import API", () => {
  beforeAll(async () => {
    await cleanTestDatabase(server.getDataDir());
    await server.start();
  }, { timeout: 120000 });

  afterAll(async () => {
    await server.stop();
    await cleanTestDatabase(server.getDataDir());
  }, { timeout: 120000 });

  it("parses symbol and footprint files over HTTP", async () => {
    const symbolRes = await fetch(`${BASE_URL}/parse-symbol`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: readFixture("simple_resistor.kicad_sym"),
        fileName: "simple_resistor.kicad_sym",
      }),
    });
    const symbolJson = await symbolRes.json() as any;
    expect(symbolRes.status).toBe(200);
    expect(symbolJson.data.symbol.name).toBe("R");

    const footprintRes = await fetch(`${BASE_URL}/parse-footprint`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: readFixture("C_0603_1608Metric.kicad_mod"),
        fileName: "C_0603_1608Metric.kicad_mod",
      }),
    });
    const footprintJson = await footprintRes.json() as any;
    expect(footprintRes.status).toBe(200);
    expect(footprintJson.data.footprint.name).toBe("C_0603_1608Metric");
  });

  it("previews bundled KiCad imports over HTTP", async () => {
    const formData = new FormData();
    formData.append(
      "symbol",
      new File([readFixture("simple_capacitor.kicad_sym")], "simple_capacitor.kicad_sym"),
    );
    formData.append(
      "footprint",
      new File([readFixture("C_0603_1608Metric.kicad_mod")], "C_0603_1608Metric.kicad_mod"),
    );
    formData.append("model", new File(["step"], "C_0603_1608Metric.step"));

    const previewRes = await fetch(`${BASE_URL}/preview`, {
      method: "POST",
      body: formData,
    });
    const previewJson = await previewRes.json() as any;
    expect(previewRes.status).toBe(200);
    expect(previewJson.data.preview.groups.length).toBeGreaterThanOrEqual(1);
  });
});
