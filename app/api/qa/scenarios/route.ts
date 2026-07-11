import { proxyQaPersona } from "../../../../lib/qaPersonaProxy";

export const dynamic = "force-dynamic";
export const GET = () => proxyQaPersona("/qa/scenarios");
