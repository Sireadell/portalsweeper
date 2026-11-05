// The "modelled example" on /money. Every input is made up to show the shape of each money line.
// Testnet coins have no value, so none of this is income and none of it is a forecast.
export const MODEL_INPUTS = {
  portalsSold: 500,
  portalPrice: 20, // example coins per Portal
  backedPerWeek: 1000, // example coins put on players in a week
  cutBps: 500,
  sponsoredDaysPerWeek: 1,
  sponsorPrize: 100, // example coins the sponsor puts up as a day's prize
  sponsorFeeBps: 2000, // example fee on top of the prize
};

export type ModelRow = { line: string; formula: string; inputs: string; result: string };

export function modelRows(i = MODEL_INPUTS): ModelRow[] {
  const sales = i.portalsSold * i.portalPrice;
  const cut = Math.floor((i.backedPerWeek * i.cutBps) / 10_000);
  const fee = Math.floor((i.sponsorPrize * i.sponsorFeeBps) / 10_000) * i.sponsoredDaysPerWeek;
  return [
    {
      line: "Portal sales",
      formula: "Portals sold x price",
      inputs: `${i.portalsSold} Portals x ${i.portalPrice} coins`,
      result: `${sales.toLocaleString("en-US")} coins, once, and on my design it all goes into prize pots`,
    },
    {
      line: "Pool cut",
      formula: `${i.cutBps / 100}% x coins backed`,
      inputs: `${i.backedPerWeek.toLocaleString("en-US")} coins backed in a week`,
      result: `${cut} coins a week`,
    },
    {
      line: "Sponsored day",
      formula: "Sponsor pays the prize, plus a fee on top",
      inputs: `${i.sponsoredDaysPerWeek} day a week, ${i.sponsorPrize} coin prize, ${i.sponsorFeeBps / 100}% fee`,
      result: `${fee} coins a week in fees`,
    },
  ];
}
