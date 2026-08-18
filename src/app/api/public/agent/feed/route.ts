import { getPublicProperties } from '../../properties/route';

export async function GET(request: Request) {
  return getPublicProperties(request, { requireConfiguredApiKey: false });
}
