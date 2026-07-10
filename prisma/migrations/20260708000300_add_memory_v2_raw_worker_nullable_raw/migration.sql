-- DropForeignKey
ALTER TABLE "RefinementJob" DROP CONSTRAINT "RefinementJob_rawMemoryId_fkey";

-- AlterTable
ALTER TABLE "RefinementJob" ALTER COLUMN "rawMemoryId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "RefinementJob" ADD CONSTRAINT "RefinementJob_rawMemoryId_fkey" FOREIGN KEY ("rawMemoryId") REFERENCES "RawMemory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

