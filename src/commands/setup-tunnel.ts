import * as p from "@clack/prompts";

import { t } from "../i18n/index.js";
import { DEFAULT_TUNNEL_TYPE, type TunnelType } from "../tunnel/types.js";

export interface TunnelSetupResult {
  tunnelType: TunnelType;
  ngrokAuthtoken?: string;
}

export async function promptTunnelSetup(
  existing: { tunnel?: TunnelType; ngrok_authtoken?: string } | null
): Promise<TunnelSetupResult> {
  const currentTunnel = existing?.tunnel ?? DEFAULT_TUNNEL_TYPE;

  let initialValue: string;
  if (currentTunnel === false) initialValue = "disabled";
  else if (currentTunnel === "cloudflare" || currentTunnel === "ngrok")
    initialValue = currentTunnel;
  else initialValue = "cloudflare";

  const result = await p.select({
    message: t("setup.tunnelMessage"),
    initialValue,
    options: [
      { value: "cloudflare", label: "Cloudflare (free, no signup)" },
      { value: "ngrok", label: "ngrok (requires authtoken)" },
      // TODO: re-add custom HTTPS URL option
      // { value: "custom", label: "Custom HTTPS URL" },
      { value: "disabled", label: "Disabled (localhost only)" },
    ],
  });

  if (p.isCancel(result)) {
    p.cancel(t("setup.cancelled"));
    process.exit(0);
  }

  if (result === "disabled") return { tunnelType: false };
  if (result === "cloudflare") return { tunnelType: "cloudflare" };

  if (result === "ngrok") {
    const authtoken = await p.text({
      message: t("setup.ngrokAuthtokenMessage"),
      placeholder: t("setup.ngrokAuthtokenPlaceholder"),
      initialValue: existing?.ngrok_authtoken ?? "",
      validate(value) {
        if (!value || !value.trim()) return t("setup.ngrokAuthtokenRequired");
      },
    });

    if (p.isCancel(authtoken)) {
      p.cancel(t("setup.cancelled"));
      process.exit(0);
    }

    const token = (authtoken as string).trim();
    await verifyNgrokAuthtoken(token);

    return { tunnelType: "ngrok", ngrokAuthtoken: token };
  }

  // TODO: re-enable custom URL tunnel prompt
  // const customUrl = await p.text({
  //   message: t("setup.tunnelCustomUrlMessage"),
  //   placeholder: t("setup.tunnelCustomUrlPlaceholder"),
  //   initialValue:
  //     typeof currentTunnel === "string" && currentTunnel.startsWith("https://")
  //       ? currentTunnel
  //       : "",
  //   validate(value) {
  //     if (!value || !value.trim()) return t("tunnel.customUrlInvalid");
  //     try {
  //       const parsed = new URL(value.trim());
  //       if (parsed.protocol !== "https:") return t("tunnel.customUrlMustBeHttps");
  //       if (!parsed.hostname) return t("tunnel.customUrlInvalid");
  //     } catch {
  //       return t("tunnel.customUrlInvalid");
  //     }
  //   },
  // });
  //
  // if (p.isCancel(customUrl)) {
  //   p.cancel(t("setup.cancelled"));
  //   process.exit(0);
  // }
  //
  // return { tunnelType: (customUrl as string).trim() as `https://${string}` };

  return { tunnelType: "cloudflare" };
}

async function verifyNgrokAuthtoken(authtoken: string): Promise<void> {
  const s = p.spinner();
  s.start(t("setup.ngrokVerifying"));

  let listener: { url(): string | null; close(): Promise<void> } | null = null;
  try {
    const ngrok = await import("@ngrok/ngrok");
    listener = await ngrok.default.forward({ addr: 1, authtoken });
    s.stop(t("setup.ngrokVerified"));
  } catch (err) {
    s.stop(t("setup.ngrokVerifyFailed"));
    throw err;
  } finally {
    listener?.close().catch(() => {});
  }
}
