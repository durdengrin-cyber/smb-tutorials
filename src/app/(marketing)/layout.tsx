import { getIdentity } from "@/lib/auth";
import { MarketingHeader } from "@/components/marketing-header";

export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const identity = await getIdentity();
  return (
    <>
      <MarketingHeader signedIn={identity !== null} />
      {children}
    </>
  );
}
