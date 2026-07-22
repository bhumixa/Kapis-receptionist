/** Mirrors `backend/src/modules/services/interface/dto/service-response.dto.ts`. */
export interface Service {
  id: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceCents: number;
  currency: string;
  bufferTimeMinutes: number;
  isActive: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}
