-- Start empty: account creation, chat history and offline dates are not visits.
CREATE TABLE "UserVisitDay" (
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    CONSTRAINT "UserVisitDay_pkey" PRIMARY KEY ("userId", "day")
);

ALTER TABLE "UserVisitDay" ADD CONSTRAINT "UserVisitDay_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
