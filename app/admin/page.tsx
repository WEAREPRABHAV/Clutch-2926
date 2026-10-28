import { LegacySite } from "../../components/legacy-site";

export const metadata = { title: "CLUTCH / 26 — Admin" };

export default function AdminPage() {
  return <LegacySite src="/site.html?admin=1" title="CLUTCH / 26 admin console" />;
}

