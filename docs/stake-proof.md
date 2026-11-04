# Real stake run on Portaldot V3

Every row is a real transfer on the Portaldot V3 testnet (tPOT has no value). Players A and B each lock 0.01 tPOT in the escrow wallet, then the escrow pays the winner or refunds a draw. Open a block link and find the transaction hash in it.

| # | What | Transaction hash | Block |
|---|---|---|---|
| 1 | Top up player A | `0x29b1e060e53bc04ef875feb55c714fed0487b02613d9f7f244965e3c2aa0e676` | [325747](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325747) |
| 2 | Top up player B | `0x18516b1726b9c5845a03473b8648543431d93aedfbfa632abc6c2382f869a923` | [325750](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325750) |
| 3 | Match 1: player A locks | `0x03e63c626659d3c1bc1faacdba464c5fe352553a754df3e086b9ff00bb5f11f0` | [325752](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325752) |
| 4 | Match 1: player B locks | `0xce2c293cf1bcbaebe789180e88fe573d14fcfbe0d809e6eb560c078cd506d1f5` | [325753](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325753) |
| 5 | Match 1: payout to player A | `0xb9de620e9ff12ac778a9d1508be44bfea366307268185a7c8239c04b7a3aa2e5` | [325754](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325754) |
| 6 | Match 2: player A locks | `0x18e4c0b820c3288ba7fe852c5511773d0f97cf7f222d1977cab0953130516733` | [325756](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325756) |
| 7 | Match 2: player B locks | `0x3665b217139daaff3c00477b51d6e15b7ae4de70d2dacc86860e73a62dcee29b` | [325759](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325759) |
| 8 | Match 2: refund | `0x56ca41c7706046892ee10c7828acba723fe388741cff2e1da3ab86a807afc067` | [325761](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325761) |
| 9 | Match 2: refund | `0xa3f2513391f45b28b36ea46ce3211d35d212860f4a3fa0436bf29bbcfde430b4` | [325762](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325762) |
| 10 | Match 3: player A locks | `0x461a0b13487817fd7b1e27b6ff02074c6d37cc9edce4ac54d0a0f12d035da64b` | [325763](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325763) |
| 11 | Match 3: player B locks | `0xaec7e222047ab10b71d08ba7f3c59d41454303bc7cd5baf9d3f64b552d9be83c` | [325764](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325764) |
| 12 | Match 3: payout to player B | `0x966bc68ebbc2625cf701eb58fc4285c8b8a2837fec9fbac789299800a8d9fab4` | [325765](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325765) |
| 13 | Match 4: player A locks | `0xa82a114b49d3f88965356cf1241d2dfb5d5b19641f1f3596db917b56f6346adf` | [325767](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325767) |
| 14 | Match 4: player B locks | `0xc9b46ffc081c32b23f35063d1601edbc71ef2f3ff1467fcdebcc13c450768bed` | [325769](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325769) |
| 15 | Match 4: refund | `0xb176f4ff5e8f272641e869cd21632fcf03b8dac640c0d7d3655671f2a37a85db` | [325771](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325771) |
| 16 | Match 4: refund | `0xad0653178d603affdbf91cdadabbcdbf1aeea681d058c11f43c3a6c22498717b` | [325773](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325773) |
| 17 | Match 5: player A locks | `0xabc4945d69207496f91072814658490c493782efae7e465c046910e60711f427` | [325775](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325775) |
| 18 | Match 5: player B locks | `0xd6e55e7b171fc7e1174de0ec494f247acb7404ea8f8fa60ee054ad1bdf403c7c` | [325777](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325777) |
| 19 | Match 5: payout to player A | `0x3ac9728f9fbef4a7e522606cec24676ddf58bac85907d7b27927a9365c5471ef` | [325779](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325779) |
| 20 | Match 6: player A locks | `0xa6548f465bbe4720c6a67faa130b5704a0ade963cf9ae9ccbb765f2ed7bee669` | [325780](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325780) |
| 21 | Match 6: player B locks | `0xb2d15fc5e74c6ae09e9f89c1fbd3d231f1bbc5c23016010302674cf1772554e3` | [325782](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325782) |
| 22 | Match 6: refund | `0xeee459e4436f6ecab0215dae4b5b94ca01485a57632fd77f142b6c6982547b5e` | [325783](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325783) |
| 23 | Match 6: refund | `0x14b2b28967953701565f7e124f5a098509d9e58921bfcbe06ef5647ab15d301c` | [325784](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325784) |
| 24 | Match 7: player A locks | `0x59359fa20360ad7e0b833c304daf919c2d67811f4ff7ee26aad3dda9c207ebdb` | [325786](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325786) |
| 25 | Match 7: player B locks | `0x1aa6966c7009d45a8d0789305b551a5d295c4faaaed83d87734200cfbc3a301f` | [325789](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325789) |
| 26 | Match 7: payout to player B | `0x379fdda2c987aaab3277f5cb850d57c7eb748be6fc33586eeb72ec3a2a81311c` | [325792](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325792) |
| 27 | Match 8: player A locks | `0xe482c5cb0ea70fcf73fc6c3bb171ae92fe786c78e308d94b81e924720ed847b2` | [325794](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325794) |
| 28 | Match 8: player B locks | `0x29173bc5520b26267fb5ea0cb36b46351f942fd31e3b012caeee206ee6a21cc0` | [325798](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325798) |
| 29 | Match 8: refund | `0xf1863148214ba1e781979ff4b2b4bd1e9b0716b8ec82a45b6bc8916dbc835a07` | [325800](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325800) |
| 30 | Match 8: refund | `0x5b9f071f5bf60057f8d18d56e711059174d229896aaa6076cd9c3b10a3a8829a` | [325803](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325803) |
| 31 | Match 9: player A locks | `0xad5d6fbdd5ab2526bb843a37d5d44f072bec6d1b65e34b8e559d42b0d596e4b2` | [325807](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325807) |
| 32 | Match 9: player B locks | `0x5486177772eb26699fcc5e34d93d00103847d86e2d48529293efc25d2a14ea33` | [325809](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325809) |
| 33 | Match 9: payout to player A | `0x9f31214e6c130f6a1664eb7081c55b9a446d273c3dff989bbfbef32cbcb7f671` | [325812](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325812) |
| 34 | Match 10: player A locks | `0xf991842382529d21abfe8229e882ead0d2883816a0e0dd69fa435b7375d4e45c` | [325814](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325814) |
| 35 | Match 10: player B locks | `0x0e9718fb37cd97c024086406b50b6b05420617ba5008bd2c22befb4e971e20cd` | [325816](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325816) |
| 36 | Match 10: refund | `0xcfe9fa9037b6884301b03cc1153427cb89fadf089b47ecf0a4d9985ffe23c57a` | [325818](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325818) |
| 37 | Match 10: refund | `0xe7c3b2838bd449c27fada8fef4b124247f646bb9688974e3e35efc24515949b9` | [325820](https://node-console.portaldot.dev/?rpc=wss%3A%2F%2Ftest-node-v3.portaldot.dev#/explorer/query/325820) |
