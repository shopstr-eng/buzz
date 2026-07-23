import { Outlet } from "@tanstack/react-router";
import { ChannelSidebar } from "./ChannelSidebar";

/** Two-column layout: fixed sidebar + scrollable main area. */
export function AppLayout() {
  return (
    <div className="flex h-dvh overflow-hidden">
      <ChannelSidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
