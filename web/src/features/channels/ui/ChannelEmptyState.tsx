import { Hash } from "lucide-react";

export function ChannelEmptyState() {
  return (
    <div className="flex flex-1 items-center justify-center bg-white dark:bg-[#111111]">
      <div className="flex flex-col items-center text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black/5 dark:bg-white/10">
          <Hash className="h-7 w-7 text-black/30 dark:text-white/30" />
        </div>
        <h2 className="mt-4 text-base font-semibold text-black dark:text-white">
          Select a channel
        </h2>
        <p className="mt-1 text-sm text-black/50 dark:text-white/50">
          Choose a channel from the sidebar to start chatting.
        </p>
      </div>
    </div>
  );
}
