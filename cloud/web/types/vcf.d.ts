declare module "vcf" {
  type VCardProperty = {
    valueOf(): unknown;
  };

  class VCard {
    data: Record<string, VCardProperty | VCardProperty[] | undefined>;
    version: string;

    static parse(value: string): VCard[];
  }

  export = VCard;
}
