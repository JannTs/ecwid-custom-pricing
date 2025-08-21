import { NextRequest, NextResponse } from "next/server";

type Body = {
  lengthMm: number;
  thickness: "0.5" | "0.6" | "0.7";
  baseSku?: string; // например: WIDTH-1210...
};

const SURCHARGE: Record<string, number> = { "0.5": 0, "0.6": 3, "0.7": 4 };

function calc(lengthMm: number, thickness: "0.5" | "0.6" | "0.7") {
  const widthM = 1.21;
  const lengthM = lengthMm / 1000;
  const area = +(widthM * lengthM).toFixed(3);
  const base = +(area * 22).toFixed(2);
  const add = +(area * SURCHARGE[thickness]).toFixed(2);
  const final = +(base + add).toFixed(2);
  return { widthM, lengthM, area, base, add, final };
}

function tt2(th: string) {
  if (th === "0.5") return "05";
  if (th === "0.6") return "06";
  if (th === "0.7") return "07";
  return String(th).replace(".", "").padStart(2, "0");
}

function corsHeaders(origin: string | null) {
  const allowed = process.env.ALLOWED_ORIGIN || origin || "*";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  } as Record<string, string>;
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  try {
    const { ECWID_STORE_ID, ECWID_TOKEN } = process.env;
    if (!ECWID_STORE_ID || !ECWID_TOKEN) {
      return NextResponse.json(
        { error: "Server not configured" },
        { status: 500, headers }
      );
    }

    const body = (await req.json()) as Body;
    const lengthMm = Number(body.lengthMm);
    const thickness = String(body.thickness) as Body["thickness"];
    const baseSku = (body.baseSku || "").toUpperCase();

    if (!Number.isFinite(lengthMm) || lengthMm < 1000 || lengthMm > 12000) {
      return NextResponse.json(
        { error: "Length must be 1000..12000 mm" },
        { status: 400, headers }
      );
    }
    if (!["0.5", "0.6", "0.7"].includes(thickness)) {
      return NextResponse.json(
        { error: "Thickness must be 0.5/0.6/0.7" },
        { status: 400, headers }
      );
    }
    if (baseSku && !/^WIDTH-1210\b/.test(baseSku)) {
      return NextResponse.json(
        { error: "Base SKU not allowed" },
        { status: 400, headers }
      );
    }

    const c = calc(lengthMm, thickness);

    const sku = baseSku
      ? `${baseSku}-${lengthMm}-${tt2(thickness)}`
      : `CUST-${Date.now()}-${lengthMm}-${tt2(thickness)}`;

    const name = baseSku
      ? `Лист ${baseSku.replace(
          "WIDTH-",
          ""
        )}мм × ${lengthMm}мм, ${thickness}мм (индивидуальный расчёт)`
      : `Лист 1210мм × ${lengthMm}мм, ${thickness}мм (индивидуальный расчёт)`;

    const description = `Площадь: ${c.area} м². База: ${c.base} €. Наценка: ${c.add} €. Итог: ${c.final} €`;

    // Ecwid REST (авторизация через заголовок Authorization: Bearer)
    const apiBase = `https://app.ecwid.com/api/v3/${ECWID_STORE_ID}`;
    const res = await fetch(`${apiBase}/products`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ECWID_TOKEN}`,
        Accept: "application/json",
      },
      body: JSON.stringify({
        name,
        price: c.final,
        sku,
        enabled: true,
        showOnFrontpage: 0,
        trackQuantity: false,
        description,
        attributes: [{ name: "customPriceOneOff", value: "true" }],
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      return NextResponse.json(
        { error: `Create failed: ${res.status} ${txt}` },
        { status: 502, headers }
      );
    }

    const created = (await res.json()) as { id: number };
    return NextResponse.json(
      { ok: true, productId: created.id, price: c.final, area: c.area, sku },
      { headers }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500, headers });
  }
}

export const runtime = "nodejs";
