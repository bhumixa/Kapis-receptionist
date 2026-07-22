/** A tenant's service-catalog grouping (e.g. "Hair", "Nails", "Spa") — optional on `Service`. */
export interface ServiceCategoryEntity {
  id: string;
  tenantId: string;
  name: string;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}
