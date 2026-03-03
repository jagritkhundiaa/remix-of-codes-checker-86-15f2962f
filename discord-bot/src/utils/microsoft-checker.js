// ============================================================
//  Microsoft Code Checker — exact same logic as the edge function
// ============================================================

const { proxiedFetch } = require("./proxy-manager");

const titleCache = new Map();

async function checkSingleCode(code, wlid) {
  const trimmedCode = code.trim();
  if (!trimmedCode || trimmedCode.length < 18) {
    return { code: trimmedCode, status: "invalid" };
  }

  let retryCount = 0;
  while (retryCount < 3) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await proxiedFetch(
        `https://purchase.mp.microsoft.com/v7.0/tokenDescriptions/${trimmedCode}?market=US&language=en-US&supportMultiAvailabilities=true`,
        {
          method: "GET",
          headers: {
            Authorization: wlid,
            Accept: "application/json, text/javascript, */*; q=0.01",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            Origin: "https://www.microsoft.com",
            Referer: "https://www.microsoft.com/",
          },
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      if (response.status === 429) {
        await delay(5000);
        retryCount++;
        continue;
      }

      const data = await response.json();
      let title = "N/A";

      if (data.products && data.products.length > 0) {
        const product = data.products[0];
        title = product.sku?.title || product.title;
        if (!title && product.localizedProperties?.[0]) {
          title = product.localizedProperties[0].productTitle;
        }
      } else if (data.universalStoreBigIds && data.universalStoreBigIds.length > 0) {
        const parts = data.universalStoreBigIds[0].split("/");
        const productId = parts[0];
        const skuId = parts[1];

        if (titleCache.has(productId)) {
          title = titleCache.get(productId);
        } else {
          try {
            const catalogRes = await proxiedFetch(
              `https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${productId}&market=US&languages=en-US`
            );
            if (catalogRes.status === 200) {
              const catalogData = await catalogRes.json();
              if (catalogData.Products && catalogData.Products.length > 0) {
                const p = catalogData.Products[0];
                if (p.DisplaySkuAvailabilities) {
                  const matchingSku = p.DisplaySkuAvailabilities.find(
                    (s) => s.Sku.SkuId === skuId
                  );
                  if (matchingSku?.Sku?.LocalizedProperties?.[0]) {
                    title =
                      matchingSku.Sku.LocalizedProperties[0].SkuTitle ||
                      matchingSku.Sku.LocalizedProperties[0].SkuDescription;
                  }
                }
                if (title === "N/A" && p.LocalizedProperties?.[0]) {
                  title = p.LocalizedProperties[0].ProductTitle;
                }
                if (title !== "N/A") titleCache.set(productId, title);
              }
            }
          } catch {
            title = `ID: ${productId}`;
          }
        }
      }

      const cleanTitle = (title || "N/A").trim();

      if (data.tokenState === "Active")
        return { code: trimmedCode, status: "valid", title: cleanTitle };
      if (data.tokenState === "Redeemed")
        return { code: trimmedCode, status: "used", title: cleanTitle };
      if (data.tokenState === "Expired")
        return { code: trimmedCode, status: "expired", title: cleanTitle };
      if (data.code === "NotFound")
        return { code: trimmedCode, status: "invalid" };
      if (data.code === "Unauthorized")
        return { code: trimmedCode, status: "error", error: "WLID unauthorized" };

      return { code: trimmedCode, status: "invalid" };
    } catch (error) {
      retryCount++;
      if (retryCount >= 3)
        return { code: trimmedCode, status: "error", error: String(error) };
      await delay(1000);
    }
  }
  return { code: trimmedCode, status: "error", error: "Max retries exceeded" };
}

async function processWithWorkerPool(items, concurrency, fn, onProgress, signal) {
  const results = new Array(items.length);
  let currentIndex = 0;
  let completedCount = 0;

  async function worker() {
    while (true) {
      if (signal && signal.aborted) break;
      const index = currentIndex++;
      if (index >= items.length) break;
      try {
        results[index] = await fn(items[index], index);
      } catch (error) {
        results[index] = { error: String(error) };
      }
      completedCount++;
      if (onProgress && completedCount % 10 === 0) {
        onProgress(completedCount, items.length);
      }
    }
  }

  const workers = Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(() => worker());
  await Promise.all(workers);
  return results.filter(Boolean);
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function checkCodes(wlids, codes, threads = 10, onProgress, signal) {
  const formattedWlids = wlids.map((w) =>
    w.includes("WLID1.0=") ? w.trim() : `WLID1.0="${w.trim()}"`
  );

  const MAX_PER_WLID = 40;
  const tasks = [];
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i].trim();
    if (!code) continue;
    const wlidIndex = Math.floor(i / MAX_PER_WLID);
    if (wlidIndex >= formattedWlids.length) break;
    tasks.push({ code, wlid: formattedWlids[wlidIndex] });
  }

  const concurrency = Math.min(threads, 100);
  const results = await processWithWorkerPool(
    tasks,
    concurrency,
    async (task) => checkSingleCode(task.code, task.wlid),
    onProgress,
    signal
  );

  return results;
}

module.exports = { checkCodes, checkSingleCode };
