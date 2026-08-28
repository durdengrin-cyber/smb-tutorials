export function PageHeader({
  title,
  description,
  as: Heading = "h1",
}: {
  title: string;
  description?: string;
  as?: "h1" | "h2";
}) {
  return (
    <div className="mb-8">
      <Heading className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</Heading>
      {description && <p className="mt-2 text-muted-foreground">{description}</p>}
    </div>
  );
}
