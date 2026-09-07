/**
 * This code imports libraries that we need to have:
 * 
 * express : helps us build a server
 * cors: let's us communicate with the dashboard. it explicityly 
 * gives the dashboard's servers to access our video and play. 
 * 
 */

const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

/*
This is where you'll set up information about your video. 

*/
let currentVideoStream = {
  data: null,
  codec: null, //eg. H.264
  format: null,
};


