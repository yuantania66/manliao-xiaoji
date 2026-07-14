import { notFound } from "next/navigation";

import H1ReviewClient from "./h1-review-client";

export default function H1ReviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <H1ReviewClient />;
}
