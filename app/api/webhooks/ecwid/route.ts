import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type EcwidAttr = { name?: string; value?: unknown };
type EcwidItem = {
  id?: number;
  productId?: number;
  product?: { id?: number; attributes?: EcwidAttr[] };
  attributes?: EcwidAttr[];
};
type EcwidPayload = {
  eventType?: string;
  order?: { items?: EcwidItem[] };
  data?: { order?: { items?: EcwidItem[] } };
  items?: EcwidItem[]; // fallback на случай другого формата
};

function hasOneOffFlag(attrs: unknown): boolean {
  if (!Array.isArray(attrs)) return false;
  return attrs.some((a) => {
    const name = String((a as EcwidAttr)?.name ?? "").toLowerCase();
    const val = String((a as EcwidAttr)?.value ?? "").toLowerCase();
    return (
      (name === "custompriceoneoff" || name === "custompriceoneoff") &&
      val === "true"
    );
  });
}

function pickItems(payload: EcwidPayload): EcwidItem[] {
  return (
    payload?.order?.items || payload?.data?.order?.items || payload?.items || []
  );
}

function getProductIdFromItem(it: EcwidItem): number | undefined {
  return it.productId ?? it.product?.id ?? it.id;
}

async function deleteProduct(
  storeId: string,
  token: string,
  productId: number | string
) {
  const url = `https://app.ecwid.com/api/v3/${storeId}/products/${productId}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`DELETE ${productId} failed: ${res.status} ${txt}`);
  }
}

export async function POST(req: NextRequest) {
  const { ECWID_STORE_ID, ECWID_TOKEN, WEBHOOK_SHARED_SECRET } = process.env;
  if (!ECWID_STORE_ID || !ECWID_TOKEN) {
    return NextResponse.json(
      { ok: false, error: "Server not configured" },
      { status: 500 }
    );
  }

  // (опционально) простая защита секретом: добавьте ?secret=... к URL вебхука в Ecwid
  if (WEBHOOK_SHARED_SECRET) {
    const url = new URL(req.url);
    if (url.searchParams.get("secret") !== WEBHOOK_SHARED_SECRET) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }
  }

  const payload = (await req.json().catch(() => ({}))) as EcwidPayload;

  const items = pickItems(payload);
  const toDelete: (number | string)[] = [];

  for (const it of items) {
    const attrs = it.attributes ?? it.product?.attributes ?? [];
    if (!hasOneOffFlag(attrs)) continue;
    const pid = getProductIdFromItem(it);
    if (pid != null) toDelete.push(pid);
  }

  // Удаляем без дублей
  const unique = Array.from(new Set(toDelete.map(String)));

  const results: Array<{
    productId: string;
    deleted: boolean;
    error?: string;
  }> = [];
  for (const pid of unique) {
    try {
      await deleteProduct(ECWID_STORE_ID, ECWID_TOKEN, pid);
      results.push({ productId: pid, deleted: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ productId: pid, deleted: false, error: msg });
    }
  }

  return NextResponse.json({
    ok: true,
    eventType: payload.eventType || null,
    count: unique.length,
    results,
  });
}
