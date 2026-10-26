import type { RawEntity } from '../../src/qloo/client'
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
export const movies:RawEntity[]=Array.from({length:8},(_,i)=>({entity_id:id(i+1),name:['Harbour Lights','The Quiet Year','Paper Kites','Winter Signal','Blue Orchard','Small Hours','North Window','Glass Harbour'][i],types:['urn:entity:movie'],popularity:.971+i*.003,properties:{release_year:1990+i*2},external:{imdb:[{user_rating:6+i*.2}]},query:{affinity:.3+i*.05}}))

export function makeEntities(kind: string, start: number, popularityValue: number): RawEntity[] {
  return Array.from({ length: 32 }, (_, index) => {
    const properties: Record<string, unknown> = {
      release_year: 1990 + index,
      publication_year: 1980 + index,
      date_of_birth: `${String(1950 + index).padStart(4, '0')}-06-15`,
      start_year: 1980 + index,
      neighborhood: `Neighborhood ${index}`,
      business_rating: 2 + index * 0.1,
    }
    return {
      entity_id: id(start + index),
      name: `${kind} title ${index}`,
      types: [`urn:entity:${kind}`],
      popularity: popularityValue,
      properties,
      external: { imdb: [{ user_rating: 5 + index * 0.2 }] },
      query: { affinity: 0.3 + index * 0.01 },
    }
  })
}
