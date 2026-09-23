import type { Env } from "../_lib/env";
import { createSessionHandler } from "../_lib/session";

const handleSession = createSessionHandler();

export const onRequest: PagesFunction<Env> = (context) =>
  handleSession(context.request, context.env, (promise) => context.waitUntil(promise));
