import { index, route, rootRoute } from "@tanstack/virtual-file-routes";

export const routes = rootRoute("root.tsx", [
  index("index.tsx"),
  route("/login", "login.tsx"),
  route("/invite/$code", "invite.$code.tsx"),
  route("/repos", "repos.tsx", [
    index("repos.index.tsx"),
    route("$repoId", "repos.$repoId.tsx"),
    route("$repoId/blob/$", "repos.$repoId.blob.$.tsx"),
  ]),
  route("/channels", "channels.tsx", [
    index("channels.index.tsx"),
    route("$groupId", "channels.$groupId.tsx"),
  ]),
]);
