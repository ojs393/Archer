export interface SesRegion {
  id: string;
  label: string;
}

export const SES_REGIONS: readonly SesRegion[] = [
  { id: "us-east-1", label: "N. Virginia" },
  { id: "us-east-2", label: "Ohio" },
  { id: "us-west-1", label: "N. California" },
  { id: "us-west-2", label: "Oregon" },
  { id: "ca-central-1", label: "Canada Central" },
  { id: "eu-west-1", label: "Ireland" },
  { id: "eu-west-2", label: "London" },
  { id: "eu-west-3", label: "Paris" },
  { id: "eu-central-1", label: "Frankfurt" },
  { id: "eu-north-1", label: "Stockholm" },
  { id: "eu-south-1", label: "Milan" },
  { id: "ap-south-1", label: "Mumbai" },
  { id: "ap-northeast-1", label: "Tokyo" },
  { id: "ap-northeast-2", label: "Seoul" },
  { id: "ap-northeast-3", label: "Osaka" },
  { id: "ap-southeast-1", label: "Singapore" },
  { id: "ap-southeast-2", label: "Sydney" },
  { id: "sa-east-1", label: "São Paulo" },
  { id: "me-south-1", label: "Bahrain" },
  { id: "af-south-1", label: "Cape Town" },
  { id: "il-central-1", label: "Tel Aviv" },
];

export const SES_SMTP_PORT = 587;

const REGION_IDS: ReadonlySet<string> = new Set(SES_REGIONS.map((r) => r.id));

export function isSesRegion(id: string): boolean {
  return REGION_IDS.has(id);
}

export function sesSmtpHost(region: string): string {
  return `email-smtp.${region}.amazonaws.com`;
}
