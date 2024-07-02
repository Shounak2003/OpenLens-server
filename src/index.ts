import express, { Request, Response } from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { LensClient, development, isRelaySuccess } from "@lens-protocol/client";
import { Wallet } from "ethers";
import axios from "axios";

const PK: any = process.env.PRIVATE_KEY;
const wallet = new Wallet(PK);
const pinataApiKey = process.env.PINATA_API_KEY;
const pinataSecretApiKey = process.env.PINATA_SECRET_API_KEY;

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

const lensClient = new LensClient({
  environment: development,
});

app.post("/createProfile", async (req: Request, res: Response) => {
  try {
    const { handle, to } = req.body;

    if (!handle || !to) {
      return res.status(400).json({ error: "Missing handle or to address" });
    }

    const profileCreateResult = await lensClient.wallet.createProfileWithHandle(
      {
        handle,
        to,
      }
    );

    res.json(profileCreateResult);
    console.log(profileCreateResult);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/getManagedProfiles", async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.query;

    if (!walletAddress) {
      return res.status(400).json({ error: "Missing handle" });
    }

    const managedProfiles = await lensClient.wallet.profilesManaged({
      for: walletAddress as string,
    });

    res.json(managedProfiles.items[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/loginProfile", async (req: Request, res: Response) => {
  try {
    const { address, profile_id } = req.body;

    const { id, text } = await lensClient.authentication.generateChallenge({
      signedBy: address,
      for: profile_id,
    });
    const signature = await wallet.signMessage(text);
    const auth = await lensClient.authentication.authenticate({
      id,
      signature,
    });

    res.json("Authenticated Successfully!");
    console.log("Authenticated Successfully!");
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/postContent", async (req: Request, res: Response) => {
  try {
    const { textMessage } = req.body;
    const data = JSON.stringify({
      pinataContent: textMessage,
    });

    const response = await axios.post(
      "https://api.pinata.cloud/pinning/pinJSONToIPFS",
      data,
      {
        headers: {
          pinata_api_key: pinataApiKey,
          pinata_secret_api_key: pinataSecretApiKey,
          "Content-Type": "application/json",
        },
      }
    );

    const ipfsHash = response.data.IpfsHash;
    const uri = `https://ipfs.io/ipfs/${ipfsHash}`;

    const resultTypedData =
      await lensClient.publication.createOnchainPostTypedData({
        contentURI: uri,
      });
    const { id, typedData } = resultTypedData.unwrap();

    // sign with the wallet
    const signedTypedData = await wallet._signTypedData(
      typedData.domain,
      typedData.types,
      typedData.value
    );

    console.log(`Broadcasting signed typed data...`);

    const broadcastResult = await lensClient.transaction.broadcastOnchain({
      id,
      signature: signedTypedData,
    });

    const broadcastValue = broadcastResult.unwrap();

    if (!isRelaySuccess(broadcastValue)) {
      console.log(`Something went wrong`, broadcastValue);
      return;
    }

    res.json(broadcastValue);
    console.log(broadcastValue);

    console.log(
      `Transaction was successfully broadcasted with txId ${broadcastValue.txId}`
    );
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
