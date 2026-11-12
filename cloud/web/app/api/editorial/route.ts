import { unstable_cache } from "next/cache";
import { currentEditorialSlides, readEditorialSource } from "../../../lib/editorial";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Cache both failures and successes; no cookies, credentials or user-specific keys.
const readCached = unstable_cache(readEditorialSource, ['bf12-public-editorial-v1'], { revalidate: 900 });
export async function GET() {
  const source = process.env.COFFEECITO_EDITORIAL_CSV_URL;
  if (!source) return Response.json({ status: 'unconfigured', slides: [] });
  const data = await readCached(source);
  if(data.invalidRows) console.warn('BF-12: excluded invalid rows', {count:data.invalidRows});
  return Response.json({ status:data.status, slides:currentEditorialSlides(data.slides) }, {headers:{'Cache-Control':'no-store'}});
}
