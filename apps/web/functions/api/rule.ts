import { createRuleHandler, type Env } from "../_lib/rule";

const handleRule = createRuleHandler();

export const onRequest: PagesFunction<Env> = (context) =>
  handleRule(context.request, context.env, (promise) => context.waitUntil(promise));
