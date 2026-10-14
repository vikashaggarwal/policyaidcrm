import type { Metadata } from "next";
import { requireProfile } from "@/lib/auth";
import { friendlyError } from "@/lib/errors";
import { EMPTY_COUNTS, PAGE_SIZE, toCounts, type QueueRow } from "@/lib/queue-types";
import { createClient } from "@/lib/supabase/server";
import { QueueClient } from "./queue-client";

export const metadata: Metadata = { title: "Queue" };

export default async function QueuePage() {
  await requireProfile(["caller"]);
  const supabase = await createClient();
  const [list, counts] = await Promise.all([
    supabase.rpc("my_queue", { p_filter: "todo", p_search: null, p_limit: PAGE_SIZE, p_offset: 0 }),
    supabase.rpc("my_queue_counts", { p_search: null }),
  ]);

  return (
    <QueueClient
      initialRows={(list.data ?? []) as QueueRow[]}
      initialCounts={counts.error ? EMPTY_COUNTS : toCounts((counts.data as Record<string, unknown>[] | null)?.[0])}
      initialError={list.error ? friendlyError(list.error) : null}
    />
  );
}
