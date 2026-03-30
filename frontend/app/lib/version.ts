export const VERSION = process.env.NEXT_PUBLIC_VERSION ?? "1.0.0";
export const BUILD_DATE = process.env.NEXT_PUBLIC_BUILD_DATE ?? new Date().toISOString().split("T")[0];
