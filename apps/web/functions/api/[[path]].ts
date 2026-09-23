import { errorResponse } from "../_lib/http";

// Without this, unknown /api/* paths fall through to the SPA and answer 200 with index.html.
export const onRequest: PagesFunction = () => errorResponse("not_found");
