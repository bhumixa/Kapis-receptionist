/** Mirrors `backend/src/modules/customers/interface/dto/customer-response.dto.ts`. */
export interface Customer {
  id: string;
  phoneNumber: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  preferredLanguage: string | null;
  marketingOptIn: boolean;
  createdAt: string;
  updatedAt: string;
}
