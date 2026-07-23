import { Outlet, createRootRoute } from "@tanstack/react-router";
import { RelayProvider } from "@/shared/context/relay-context";
import { ThemeProvider } from "@/shared/theme/ThemeProvider";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <ThemeProvider>
      <RelayProvider>
        <Outlet />
      </RelayProvider>
    </ThemeProvider>
  );
}
