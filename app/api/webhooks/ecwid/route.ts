import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  // Здесь разберите payload Ecwid (order.created и т.д.)
  // Пример: найти товары с атрибутом customPriceOneOff=='true' и удалить их (или отключить).
  // Удаление похоже на:
  //   await fetch(`https://app.ecwid.com/api/v3/${storeId}/products/${productId}?token=${token}`, { method: 'DELETE' })
  const payload = await req.json().catch(() => ({}));
  console.log("Webhook received:", payload);
  return NextResponse.json({ ok: true });
}
export const runtime = "nodejs";
